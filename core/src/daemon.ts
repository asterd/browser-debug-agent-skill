/**
 * Browser daemon: a long-lived Playwright helper process that persists between CLI invocations.
 * Communicates via a Unix socket (or named pipe on Windows).
 * The CLI connects to the daemon to send commands; the daemon keeps the browser alive.
 */
import { spawn, ChildProcess } from 'node:child_process';
import { createConnection, createServer, Server, Socket } from 'node:net';
import { join } from 'node:path';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { existsSync } from 'node:fs';

const SOCKET_DIR = join(tmpdir(), 'bda-daemon');
const DAEMON_TIMEOUT = 10 * 60 * 1000; // 10 min inactivity → auto-shutdown

export interface DaemonInfo {
  socketPath: string;
  pid: number;
  sessionId: string;
}

/**
 * Get the socket path for a session.
 */
export function socketPath(sessionId: string): string {
  return platform() === 'win32'
    ? `\\\\.\\pipe\\bda-${sessionId}`
    : join(SOCKET_DIR, `${sessionId}.sock`);
}

/**
 * Check if a daemon is running for the given session.
 */
export function isDaemonRunning(sessionId: string): boolean {
  const sock = socketPath(sessionId);
  if (platform() === 'win32') {
    // On Windows, named pipes don't show up in the filesystem.
    // We check by looking for the daemon info file instead.
    return existsSync(join(SOCKET_DIR, `${sessionId}.json`));
  }
  return existsSync(sock);
}

/**
 * Connect to an existing daemon and send a command.
 */
export function sendCommand(sessionId: string, method: string, params?: unknown): Promise<unknown> {
  const sock = socketPath(sessionId);
  return new Promise((resolve, reject) => {
    const client = createConnection(sock, () => {
      const msg = JSON.stringify({ method, params }) + '\n';
      client.write(msg);
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
        } catch (e) {
          reject(new Error(`Bad daemon response: ${line}`));
        }
      }
    });

    client.on('error', (err) => {
      reject(new Error(`Cannot connect to daemon: ${err.message}`));
    });

    setTimeout(() => {
      client.destroy();
      reject(new Error('Daemon response timeout'));
    }, 30000);
  });
}

/**
 * Spawn the daemon helper as a detached process.
 * Returns once the daemon is listening.
 */
export async function startDaemon(sessionId: string, projectCwd: string): Promise<DaemonInfo> {
  await mkdir(SOCKET_DIR, { recursive: true });
  const sock = socketPath(sessionId);

  // Clean stale socket
  try { await unlink(sock); } catch { /* ok */ }

  // Write the daemon script
  const scriptPath = join(SOCKET_DIR, `${sessionId}-daemon.mjs`);
  await writeFile(scriptPath, daemonScript(projectCwd, sock));

  const child = spawn('node', [scriptPath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.unref();

  // Wait for the daemon to signal it's ready
  await new Promise<void>((resolve, reject) => {
    let out = '';
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('READY')) {
        child.stdout!.off('data', onData);
        resolve();
      }
    };
    child.stdout!.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!out.includes('READY')) reject(new Error(`Daemon exited with code ${code}`));
    });
    setTimeout(() => reject(new Error('Daemon startup timeout')), 15000);
  });

  // Save daemon info
  const info: DaemonInfo = { socketPath: sock, pid: child.pid!, sessionId };
  await writeFile(join(SOCKET_DIR, `${sessionId}.json`), JSON.stringify(info));

  return info;
}

/**
 * Stop a daemon by sending the close command, then cleaning up.
 */
export async function stopDaemon(sessionId: string): Promise<void> {
  try {
    await sendCommand(sessionId, 'close');
  } catch { /* already dead */ }
  const sock = socketPath(sessionId);
  try { await unlink(sock); } catch { /* ok */ }
  try { await unlink(join(SOCKET_DIR, `${sessionId}.json`)); } catch { /* ok */ }
  try { await unlink(join(SOCKET_DIR, `${sessionId}-daemon.mjs`)); } catch { /* ok */ }
}

function daemonScript(projectCwd: string, sockPath: string): string {
  const safeCwd = projectCwd.replace(/\\/g, '\\\\');
  const safeSock = sockPath.replace(/\\/g, '\\\\');
  return `
import { createRequire } from 'module';
import { createServer } from 'net';
import { join } from 'path';
import { unlinkSync } from 'fs';

const require = createRequire(join('${safeCwd}', 'package.json'));
let chromium;
try { chromium = require('playwright').chromium; }
catch { try { chromium = require('@playwright/test').chromium; }
catch { chromium = require('playwright-core').chromium; } }

let browser, context, page;
const consoleEntries = [];
const networkEntries = [];
let lastActivity = Date.now();
const TIMEOUT = ${DAEMON_TIMEOUT};

// Auto-shutdown on inactivity
const interval = setInterval(() => {
  if (Date.now() - lastActivity > TIMEOUT) {
    cleanup();
  }
}, 30000);

async function cleanup() {
  clearInterval(interval);
  try { await browser?.close(); } catch {}
  try { unlinkSync('${safeSock}'); } catch {}
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

async function handle(method, params) {
  lastActivity = Date.now();
  switch (method) {
    case 'launch': {
      if (browser) await browser.close();
      browser = await chromium.launch({ headless: params.headless !== false });
      context = await browser.newContext({ viewport: params.viewport || { width: 1280, height: 720 } });
      page = await context.newPage();
      page.on('console', (msg) => {
        consoleEntries.push({ level: msg.type(), text: msg.text(), ts: new Date().toISOString() });
      });
      page.on('response', (resp) => {
        networkEntries.push({ method: resp.request().method(), url: resp.url(), status: resp.status() });
      });
      await page.goto(params.url, { waitUntil: 'domcontentloaded' });
      return { ok: true };
    }
    case 'navigate': {
      await page.goto(params.url, { waitUntil: 'domcontentloaded' });
      return { ok: true };
    }
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
    case 'evaluate': {
      return await page.evaluate(params.expr);
    }
    case 'console': {
      const entries = [...consoleEntries];
      consoleEntries.length = 0;
      return entries;
    }
    case 'network': {
      const entries = [...networkEntries];
      networkEntries.length = 0;
      return entries;
    }
    case 'screenshot': {
      const opts = { path: params.path };
      if (params.fullPage) opts.fullPage = true;
      if (params.selector) { await page.locator(params.selector).screenshot(opts); }
      else { await page.screenshot(opts); }
      return { path: params.path };
    }
    case 'close': {
      return { ok: true, closing: true };
    }
    case 'ping': {
      return { ok: true, pid: process.pid };
    }
  }
  throw new Error('Unknown method: ' + method);
}

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
    const result = await handle(method, params || {});
    socket.write(JSON.stringify({ result }) + '\\n');
    if (method === 'close') {
      setTimeout(() => cleanup(), 100);
    }
  } catch (err) {
    socket.write(JSON.stringify({ error: err.message }) + '\\n');
  }
}

server.listen('${safeSock}', () => {
  process.stdout.write('READY\\n');
});
`;
}
