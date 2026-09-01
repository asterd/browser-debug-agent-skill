/**
 * Browser daemon: a long-lived process that keeps a browser session alive between CLI invocations.
 * Backend-agnostic: generates a Chrome CDP or Playwright script based on the chosen backend.
 * Communicates via a Unix socket (or named pipe on Windows).
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { join, dirname } from 'node:path';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BackendName } from './adapters/factory.js';

const __dirnameDaemon = dirname(fileURLToPath(import.meta.url));
const SOCKET_DIR = join(tmpdir(), 'bda-daemon');
const DAEMON_TIMEOUT = 10 * 60 * 1000; // 10 min inactivity → auto-shutdown

export interface DaemonInfo {
  socketPath: string;
  pid: number;
  sessionId: string;
  backend: BackendName;
}

export function socketPath(sessionId: string): string {
  return platform() === 'win32'
    ? `\\\\.\\pipe\\bda-${sessionId}`
    : join(SOCKET_DIR, `${sessionId}.sock`);
}

export function isDaemonRunning(sessionId: string): boolean {
  const infoPath = join(SOCKET_DIR, `${sessionId}.json`);
  if (platform() === 'win32') {
    if (!existsSync(infoPath)) return false;
    try {
      const info = JSON.parse(readFileSync(infoPath, 'utf8')) as DaemonInfo;
      process.kill(info.pid, 0);
      return true;
    } catch {
      try { unlinkSync(infoPath); } catch {}
      return false;
    }
  }
  return existsSync(socketPath(sessionId));
}

export function sendCommand(sessionId: string, method: string, params?: unknown): Promise<unknown> {
  const sock = socketPath(sessionId);
  return new Promise((resolve, reject) => {
    const client = createConnection(sock, () => {
      client.write(JSON.stringify({ method, params }) + '\n');
    });
    let buffer = '';
    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        const line = buffer.slice(0, nl);
        client.end();
        try {
          const resp = JSON.parse(line);
          if (resp.error) reject(new Error(resp.error));
          else resolve(resp.result);
        } catch { reject(new Error(`Bad daemon response: ${line}`)); }
      }
    });
    client.on('error', (err) => reject(new Error(`Cannot connect to daemon: ${err.message}`)));
    setTimeout(() => { client.destroy(); reject(new Error('Daemon response timeout')); }, 30000);
  });
}

export async function startDaemon(sessionId: string, projectCwd: string, backend: BackendName = 'chrome-cdp'): Promise<DaemonInfo> {
  await mkdir(SOCKET_DIR, { recursive: true });
  const sock = socketPath(sessionId);
  try { await unlink(sock); } catch {}

  const scriptPath = join(SOCKET_DIR, `${sessionId}-daemon.mjs`);
  const cleanupFiles = [sock, join(SOCKET_DIR, `${sessionId}.json`), scriptPath];
  const script = backend === 'playwright'
    ? playwrightDaemonScript(projectCwd, sock, cleanupFiles)
    : chromeCdpDaemonScript(sock, cleanupFiles);

  await writeFile(scriptPath, script);

  const child = spawn('node', [scriptPath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    ...(platform() === 'win32' ? { windowsHide: true } : {}),
  });
  child.unref();

  await new Promise<void>((resolve, reject) => {
    let out = '';
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('READY')) { child.stdout!.off('data', onData); resolve(); }
    };
    child.stdout!.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => { if (!out.includes('READY')) reject(new Error(`Daemon exited with code ${code}`)); });
    setTimeout(() => reject(new Error('Daemon startup timeout')), 15000);
  });

  const info: DaemonInfo = { socketPath: sock, pid: child.pid!, sessionId, backend };
  await writeFile(join(SOCKET_DIR, `${sessionId}.json`), JSON.stringify(info));
  return info;
}

export async function stopDaemon(sessionId: string): Promise<void> {
  try { await sendCommand(sessionId, 'close'); } catch {}
  try { await unlink(socketPath(sessionId)); } catch {}
  try { await unlink(join(SOCKET_DIR, `${sessionId}.json`)); } catch {}
  try { await unlink(join(SOCKET_DIR, `${sessionId}-daemon.mjs`)); } catch {}
}

// --- Script generators ---

function escWin(s: string): string { return s.replace(/\\/g, '\\\\'); }

function sharedDaemonShell(sockPath: string, cleanupFiles: string[]): string {
  const safeSock = escWin(sockPath);
  const safeCleanup = cleanupFiles.map(f => `  try { unlinkSync('${escWin(f)}'); } catch {}`).join('\n');
  return `
import { createServer } from 'net';
import { unlinkSync } from 'fs';

let lastActivity = Date.now();
const TIMEOUT = ${DAEMON_TIMEOUT};
const interval = setInterval(() => { if (Date.now() - lastActivity > TIMEOUT) cleanup(); }, 30000);

async function cleanup() {
  clearInterval(interval);
  try { await closeBrowser(); } catch {}
${safeCleanup}
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGBREAK', cleanup);

const server = createServer((socket) => {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      processLine(socket, line);
    }
  });
});

async function processLine(socket, line) {
  try {
    const { method, params } = JSON.parse(line);
    lastActivity = Date.now();
    const result = await handle(method, params || {});
    socket.write(JSON.stringify({ result }) + '\\n');
    if (method === 'close') setTimeout(() => cleanup(), 100);
  } catch (err) {
    socket.write(JSON.stringify({ error: err.message }) + '\\n');
  }
}

server.listen('${safeSock}', () => { process.stdout.write('READY\\n'); });
`;
}

function chromeCdpDaemonScript(sockPath: string, cleanupFiles: string[]): string {
  // Import the real WebSocket client instead of re-implementing it inline.
  // The previous inlined copy corrupted frames >64KB and mis-parsed opcodes.
  const wsModuleUrl = pathToFileURL(join(__dirnameDaemon, 'adapters', 'ws-minimal.js')).href;
  return `
import { spawn, execSync } from 'child_process';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { tmpdir, platform } from 'os';
import { join } from 'path';
import { createConnection } from 'net';
import { randomBytes, createHash } from 'crypto';

const { WebSocket: WS } = await import('${wsModuleUrl}');

// --- Chrome finder ---
function findChrome() {
  const p = platform();
  if (p==='darwin') { for(const c of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium']) if(existsSync(c))return c; }
  else if (p==='win32') {
    const dirs=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean);
    const rels=['Google\\\\Chrome\\\\Application\\\\chrome.exe','Microsoft\\\\Edge\\\\Application\\\\msedge.exe'];
    for(const d of dirs)for(const r of rels){const f=join(d,r);if(existsSync(f))return f;}
    try{return execSync('where chrome',{encoding:'utf8',stdio:['pipe','pipe','ignore']}).trim().split('\\n')[0];}catch{}
  } else { for(const c of ['google-chrome','google-chrome-stable','chromium-browser','chromium']) try{return execSync('which '+c,{encoding:'utf8'}).trim();}catch{} }
  return null;
}

const consoleEntries = [];
const networkEntries = [];
const requestMethods = new Map();
const MAX_BUFFERED = 1000;
function pushCapped(buf, e) { buf.push(e); if (buf.length > MAX_BUFFERED) buf.shift(); }
let ws = null;
let chromePid = null;
let profileDir = '';
let ownsProfile = true;
let msgId = 0;
const pending = new Map();

function cdpSend(method, params={}) {
  return new Promise((res,rej) => {
    const id = ++msgId;
    pending.set(id, {resolve:res,reject:rej});
    ws.send(JSON.stringify({id,method,params}));
    setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('CDP timeout: '+method));}},15000);
  });
}

async function closeBrowser() {
  try { await cdpSend('Browser.close'); } catch {}
  ws?.close(); ws=null;
  if (chromePid) {
    if (platform()==='win32') { try{execSync('taskkill /pid '+chromePid+' /T /F',{stdio:'ignore'});}catch{} }
    else {
      // pkill -f on the user's real profile would kill THEIR Chrome windows too.
      if (ownsProfile && profileDir.startsWith(join(tmpdir(),'bda-chrome-'))) {
        try{execSync('pkill -f "'+profileDir+'"',{stdio:'ignore'});}catch{}
      }
      try{process.kill(chromePid,'SIGKILL');}catch{}
    }
    chromePid=null;
  }
}

async function handle(method, params) {
  switch(method) {
    case 'launch': {
      await closeBrowser();
      const chrome = findChrome();
      if(!chrome) throw new Error('Chrome not found');
      const net = await import('net');
      const port = await new Promise((res,rej)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const a=s.address();s.close(()=>res(a.port));});});
      const profileMode = params.profile || 'isolated';
      if (profileMode === 'user') {
        const home = process.env.HOME || process.env.USERPROFILE || '';
        profileDir = platform()==='darwin' ? join(home,'Library','Application Support','Google','Chrome')
          : platform()==='win32' ? join(process.env.LOCALAPPDATA || join(home,'AppData','Local'),'Google','Chrome','User Data')
          : join(home,'.config','google-chrome');
        ownsProfile = false;
      } else if (profileMode === 'custom' && params.userDataDir) {
        profileDir = params.userDataDir;
        ownsProfile = false;
      } else {
        profileDir = join(tmpdir(), 'bda-chrome-'+Date.now());
        ownsProfile = true;
        mkdirSync(profileDir, {recursive:true});
      }
      const args = ['--remote-debugging-port='+port,'--user-data-dir='+profileDir,'--window-size='+(params.viewport?.width||1280)+','+(params.viewport?.height||720),'--no-first-run','--no-default-browser-check','--disable-default-apps','--mute-audio'];
      if(ownsProfile) args.push('--disable-extensions','--disable-sync','--disable-translate');
      if(process.env.CI||process.env.BDA_NO_SANDBOX) args.push('--no-sandbox','--disable-dev-shm-usage');
      if(params.headless!==false) args.push('--headless=new');
      args.push(params.url);
      const proc = spawn(chrome, args, {stdio:['ignore','pipe','pipe'], shell:platform()==='win32', ...(platform()==='win32'?{windowsHide:true}:{})});
      chromePid = proc.pid;
      // Wait for CDP
      const deadline = Date.now()+10000;
      let wsUrl;
      while(Date.now()<deadline) {
        try { const r=await fetch('http://127.0.0.1:'+port+'/json'); const t=await r.json(); const pg=t.find(x=>x.type==='page'); if(pg?.webSocketDebuggerUrl){wsUrl=pg.webSocketDebuggerUrl;break;} } catch{}
        await new Promise(r=>setTimeout(r,100));
      }
      if(!wsUrl) throw new Error('Chrome CDP not available');
      ws = new WS(wsUrl);
      await ws.connect();
      ws.onMessage((m)=>{
        const d=JSON.parse(m);
        if(d.method==='Runtime.consoleAPICalled') pushCapped(consoleEntries,{level:d.params.type==='error'?'error':d.params.type==='warning'?'warn':'log',text:(d.params.args||[]).map(a=>a.value??a.description??'').join(' '),ts:new Date().toISOString()});
        else if(d.method==='Network.requestWillBeSent') requestMethods.set(d.params.requestId,d.params.request.method);
        else if(d.method==='Network.responseReceived'){const mt=requestMethods.get(d.params.requestId)||'GET';requestMethods.delete(d.params.requestId);pushCapped(networkEntries,{method:mt,url:d.params.response.url,status:d.params.response.status});}
        else if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);if(d.error)p.reject(new Error(d.error.message));else p.resolve(d.result);}
      });
      await cdpSend('Runtime.enable');
      await cdpSend('Network.enable');
      await cdpSend('Page.enable');
      await cdpSend('DOM.enable');
      const dl2=Date.now()+10000;
      while(Date.now()<dl2){try{const r=await cdpSend('Runtime.evaluate',{expression:'document.readyState',returnByValue:true});if(r.result.value==='complete'||r.result.value==='interactive')break;}catch{}await new Promise(r=>setTimeout(r,200));}
      return { ok: true };
    }
    case 'navigate': {
      await cdpSend('Page.navigate', { url: params.url });
      return { ok: true };
    }
    case 'snapshot': {
      const { nodes } = await cdpSend('Accessibility.getFullAXTree');
      // Simple format
      const lines = [];
      const nm = new Map(); const cm = new Map();
      for(const n of nodes){nm.set(n.nodeId,n);if(n.parentId){const c=cm.get(n.parentId)||[];c.push(n.nodeId);cm.set(n.parentId,c);}}
      function walk(id,d){const n=nm.get(id);if(!n)return;const r=n.role?.value||'';const na=n.name?.value||'';if(r&&r!=='none'&&r!=='generic')lines.push('  '.repeat(d)+'- '+r+(na?' "'+na+'"':''));const ch=cm.get(id)||[];for(const c of ch)walk(c,d+(r&&r!=='none'&&r!=='generic'?1:0));}
      const root=nodes.find(n=>!n.parentId);if(root)walk(root.nodeId,0);
      return { tree: lines.join('\\n')||'(empty)', refs: {} };
    }
    case 'interact': {
      const { type, selector, value, key } = params;
      if(type==='press'){await cdpSend('Input.dispatchKeyEvent',{type:'keyDown',key:key||value||''});await cdpSend('Input.dispatchKeyEvent',{type:'keyUp',key:key||value||''});return{ok:true};}
      const er=await cdpSend('Runtime.evaluate',{expression:'document.querySelector('+JSON.stringify(selector)+')',returnByValue:false});
      if(!er.result.objectId||er.result.subtype==='null')return{ok:false,error:'Element not found: '+selector};
      const oid=er.result.objectId;
      const box=await cdpSend('Runtime.callFunctionOn',{objectId:oid,functionDeclaration:'function(){const r=this.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}',returnByValue:true});
      const{x:cx,y:cy}=box.result.value;
      switch(type){
        case'click':await cdpSend('Input.dispatchMouseEvent',{type:'mousePressed',x:cx,y:cy,button:'left',clickCount:1});await cdpSend('Input.dispatchMouseEvent',{type:'mouseReleased',x:cx,y:cy,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,200));break;
        case'fill':await cdpSend('Runtime.callFunctionOn',{objectId:oid,functionDeclaration:'function(){this.focus();}'});await cdpSend('Runtime.callFunctionOn',{objectId:oid,functionDeclaration:'function(){this.value="";this.dispatchEvent(new Event("input",{bubbles:true}));}'});for(const c of(value||''))await cdpSend('Input.dispatchKeyEvent',{type:'keyDown',text:c,key:c}),await cdpSend('Input.dispatchKeyEvent',{type:'keyUp',key:c});break;
        case'hover':await cdpSend('Input.dispatchMouseEvent',{type:'mouseMoved',x:cx,y:cy});break;
        case'select':await cdpSend('Runtime.callFunctionOn',{objectId:oid,functionDeclaration:'function(v){this.value=v;this.dispatchEvent(new Event("change",{bubbles:true}));}',arguments:[{value:value||''}],returnByValue:true});break;
      }
      return { ok: true };
    }
    case 'evaluate': {
      const r = await cdpSend('Runtime.evaluate', { expression: params.expr, returnByValue: true });
      return r.result.value;
    }
    case 'console': return [...consoleEntries];
    case 'network': return [...networkEntries];
    case 'screenshot': {
      const r = await cdpSend('Page.captureScreenshot', { format:'png', ...(params.fullPage?{captureBeyondViewport:true}:{}) });
      if(params.path){const{writeFileSync}=await import('fs');writeFileSync(params.path,Buffer.from(r.data,'base64'));}
      return { path: params.path, data: params.path ? undefined : r.data };
    }
    case 'close': return { ok: true, closing: true };
    case 'ping': return { ok: true, pid: process.pid };
  }
  throw new Error('Unknown method: '+method);
}
${sharedDaemonShell(sockPath, cleanupFiles)}
`;
}

function playwrightDaemonScript(projectCwd: string, sockPath: string, cleanupFiles: string[]): string {
  const safeCwd = escWin(projectCwd);
  return `
import { createRequire } from 'module';
import { join } from 'path';

const require = createRequire(join('${safeCwd}', 'package.json'));
let chromium;
try { chromium = require('playwright').chromium; }
catch { try { chromium = require('@playwright/test').chromium; }
catch { chromium = require('playwright-core').chromium; } }

let browser, context, page;
const consoleEntries = [];
const networkEntries = [];

async function closeBrowser() {
  try { await browser?.close(); } catch {}
  browser = null; context = null; page = null;
}

async function handle(method, params) {
  switch (method) {
    case 'launch': {
      await closeBrowser();
      browser = await chromium.launch({ headless: params.headless !== false });
      context = await browser.newContext({ viewport: params.viewport || { width: 1280, height: 720 } });
      page = await context.newPage();
      page.on('console', (msg) => consoleEntries.push({ level: msg.type(), text: msg.text(), ts: new Date().toISOString() }));
      page.on('response', (resp) => networkEntries.push({ method: resp.request().method(), url: resp.url(), status: resp.status() }));
      await page.goto(params.url, { waitUntil: 'domcontentloaded' });
      return { ok: true };
    }
    case 'navigate': { await page.goto(params.url, { waitUntil: 'domcontentloaded' }); return { ok: true }; }
    case 'snapshot': {
      let tree;
      try { tree = await page.locator('body').ariaSnapshot(); }
      catch { try { tree = JSON.stringify(await page.accessibility.snapshot() || {}); }
      catch { tree = await page.evaluate(() => document.body.innerText); } }
      return { tree: typeof tree === 'string' ? tree : JSON.stringify(tree), refs: {} };
    }
    case 'interact': {
      const { type, selector, value, key } = params;
      switch (type) {
        case 'click': await page.click(selector); break;
        case 'fill': await page.fill(selector, value); break;
        case 'press': await page.press(selector || 'body', key); break;
        case 'hover': await page.hover(selector); break;
        case 'select': await page.selectOption(selector, value); break;
      }
      return { ok: true };
    }
    case 'evaluate': return await page.evaluate(params.expr);
    case 'console': return [...consoleEntries];
    case 'network': return [...networkEntries];
    case 'screenshot': {
      const opts = { path: params.path };
      if (params.fullPage) opts.fullPage = true;
      if (params.selector) await page.locator(params.selector).screenshot(opts);
      else await page.screenshot(opts);
      return { path: params.path };
    }
    case 'close': return { ok: true, closing: true };
    case 'ping': return { ok: true, pid: process.pid };
  }
  throw new Error('Unknown method: ' + method);
}
${sharedDaemonShell(sockPath, cleanupFiles)}
`;
}
