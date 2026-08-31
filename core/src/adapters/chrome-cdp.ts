/**
 * Chrome CDP Adapter — drives the user's installed Chrome via DevTools Protocol.
 * Zero external dependencies. No Playwright, no Chromium download.
 * Just launches Chrome with --remote-debugging-port and talks CDP over WebSocket.
 */
import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { WebSocket } from './ws-minimal.js';
import type {
  BrowserAdapter, OpenOpts, SnapshotResult,
  InteractAction, InteractResult, ConsoleEntry,
  NetworkEntry, ScreenshotOpts, Artifact, CookieEntry,
} from '../types.js';

const execFileP = promisify(execFile);

export class ChromeCdpAdapter implements BrowserAdapter {
  readonly name = 'chrome-cdp';
  private chromeProc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private profileDir = '';
  private port = 0;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private consoleEntries: ConsoleEntry[] = [];
  private networkEntries: NetworkEntry[] = [];
  private requestMethods = new Map<string, string>(); // requestId → HTTP method
  private artifactDir = '';
  private _exitHandler: (() => void) | null = null;
  private _ownsProfile = true;

  async version(): Promise<string> {
    const chromePath = findChrome();
    if (!chromePath) return 'not found';
    if (platform() === 'win32') {
      // Chrome on Windows doesn't support --version well; use registry or just report found
      return `Chrome found at ${chromePath}`;
    }
    try {
      const { stdout } = await execFileP(chromePath, ['--version'], { timeout: 5000 });
      return stdout.trim();
    } catch {
      return 'found (version unknown)';
    }
  }

  async open(url: string, opts?: OpenOpts): Promise<void> {
    const chromePath = findChrome();
    if (!chromePath) throw new Error('Chrome not found. Install Google Chrome.');

    this.port = await findFreePort();

    const profile = opts?.profile ?? 'isolated';
    const viewport = opts?.viewport ?? { width: 1280, height: 720 };
    const headless = opts?.headless ?? true;

    // Determine user-data-dir based on profile mode
    if (profile === 'user') {
      this.profileDir = getUserChromeProfileDir();
      this._ownsProfile = false; // Do NOT delete the user's profile on close
    } else if (profile === 'custom' && opts?.userDataDir) {
      this.profileDir = opts.userDataDir;
      this._ownsProfile = false;
    } else {
      this.profileDir = join(tmpdir(), `bda-chrome-${Date.now()}`);
      this._ownsProfile = true;
      await mkdir(this.profileDir, { recursive: true });
    }
    this.artifactDir = join(tmpdir(), `bda-artifacts-${Date.now()}`);
    await mkdir(this.artifactDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profileDir}`,
      `--window-size=${viewport.width},${viewport.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
    ];

    // For isolated profiles, disable more features for speed
    if (profile === 'isolated') {
      args.push('--disable-extensions', '--disable-sync', '--disable-translate', '--disable-background-networking');
    }
    args.push('--mute-audio');

    if (headless) {
      args.push('--headless=new');
    }

    args.push(url);

    this.chromeProc = spawn(chromePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: platform() === 'win32',
      ...(platform() === 'win32' ? { windowsHide: true } : {}),
    });

    // Safety net: kill Chrome if our process exits unexpectedly
    const pid = this.chromeProc.pid;
    const profileDir = this.profileDir;
    const exitHandler = () => { killChromeTree(pid, profileDir); };
    process.once('exit', exitHandler);
    // Store handler ref so close() can remove it
    this._exitHandler = exitHandler;

    // Wait for CDP to be ready
    const wsUrl = await this.waitForCdp();
    this.ws = new WebSocket(wsUrl);
    await this.ws.connect();

    // Register message handler FIRST (before sending any commands)
    this.ws.onMessage((msg) => {
      const data = JSON.parse(msg);
      if (data.method === 'Runtime.consoleAPICalled') {
        this.consoleEntries.push({
          level: data.params.type === 'error' ? 'error' : data.params.type === 'warning' ? 'warn' : 'log',
          text: data.params.args?.map((a: { value?: string; description?: string }) => a.value ?? a.description ?? '').join(' ') || '',
          ts: new Date().toISOString(),
        });
      } else if (data.method === 'Network.requestWillBeSent') {
        // Track the real HTTP method for each request
        this.requestMethods.set(data.params.requestId, data.params.request.method);
      } else if (data.method === 'Network.responseReceived') {
        const resp = data.params.response;
        const method = this.requestMethods.get(data.params.requestId) || 'GET';
        this.requestMethods.delete(data.params.requestId);
        this.networkEntries.push({
          method,
          url: resp.url,
          status: resp.status,
        });
      } else if (data.id && this.pending.has(data.id)) {
        const p = this.pending.get(data.id)!;
        this.pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error.message));
        else p.resolve(data.result);
      }
    });

    // Enable domains
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');

    // Wait for page to be ready (poll document.readyState)
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const result = await this.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }) as { result: { value: string } };
        if (result.result.value === 'complete' || result.result.value === 'interactive') break;
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  async snapshot(): Promise<SnapshotResult> {
    // Get the accessibility tree via CDP
    const { nodes } = await this.send('Accessibility.getFullAXTree') as { nodes: AXNode[] };
    const tree = formatAXTree(nodes);
    return { tree, refs: {} };
  }

  async interact(action: InteractAction): Promise<InteractResult> {
    try {
      const { type, selector, value, key } = action;

      if (type === 'press') {
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: key || value || '' });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key || value || '' });
        return { ok: true };
      }

      // Resolve element — use Runtime.evaluate with JSON-safe args to avoid injection
      const resolveResult = await this.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: false,
      }) as { result: { objectId?: string; subtype?: string } };

      if (!resolveResult.result.objectId || resolveResult.result.subtype === 'null') {
        return { ok: false, error: `Element not found: ${selector}` };
      }
      const objectId = resolveResult.result.objectId;

      // Get element position for mouse events via callFunctionOn (injection-safe)
      const boxResult = await this.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function() { const r = this.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }',
        returnByValue: true,
      }) as { result: { value: { x: number; y: number } } };
      const { x: cx, y: cy } = boxResult.result.value;

      switch (type) {
        case 'click':
          await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
          await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
          await new Promise(r => setTimeout(r, 200));
          break;
        case 'fill':
          // Focus via callFunctionOn, clear and set value safely
          await this.send('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: 'function() { this.focus(); }',
          });
          await this.send('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: `function(v) { this.value = ''; this.dispatchEvent(new Event('input', {bubbles:true})); }`,
          });
          for (const char of (value || '')) {
            await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char });
            await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
          }
          break;
        case 'hover':
          await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
          break;
        case 'select':
          // Set value and dispatch change — injection-safe via callFunctionOn with argument
          await this.send('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: 'function(v) { this.value = v; this.dispatchEvent(new Event("change", {bubbles:true})); }',
            arguments: [{ value: value || '' }],
            returnByValue: true,
          });
          break;
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async evaluate(expr: string): Promise<unknown> {
    const result = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
    }) as { result: { value: unknown } };
    return result.result.value;
  }

  async console(): Promise<ConsoleEntry[]> {
    const entries = [...this.consoleEntries];
    this.consoleEntries = [];
    return entries;
  }

  async network(): Promise<NetworkEntry[]> {
    const entries = [...this.networkEntries];
    this.networkEntries = [];
    return entries;
  }

  async screenshot(opts?: ScreenshotOpts): Promise<Artifact> {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      ...(opts?.fullPage ? { captureBeyondViewport: true } : {}),
    }) as { data: string };

    const path = opts?.path ?? join(this.artifactDir, `screenshot-${Date.now()}.png`);
    await writeFile(path, Buffer.from(result.data, 'base64'));
    return { path, mediaType: 'image/png' };
  }

  async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    // Wait for load
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const result = await this.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }) as { result: { value: string } };
        if (result.result.value === 'complete' || result.result.value === 'interactive') break;
      } catch { /* navigating */ }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  async resize(width: number, height: number): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 768,
    });
    await new Promise(r => setTimeout(r, 300)); // Let layout reflow
  }

  async reload(): Promise<void> {
    await this.send('Page.reload');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const result = await this.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }) as { result: { value: string } };
        if (result.result.value === 'complete') break;
      } catch { /* reloading */ }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  async waitFor(selector: string, timeout = 5000): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const result = await this.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)}) !== null`,
          returnByValue: true,
        }) as { result: { value: boolean } };
        if (result.result.value) return true;
      } catch { /* not ready */ }
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async cookies(): Promise<CookieEntry[]> {
    const result = await this.send('Network.getCookies') as { cookies: CookieEntry[] };
    return result.cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expires: c.expires,
    }));
  }

  async setCookie(cookie: CookieEntry): Promise<void> {
    await this.send('Network.setCookie', cookie);
  }

  async localStorage(origin?: string): Promise<Record<string, string>> {
    const expr = origin
      ? `(() => { const entries = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); entries[k] = localStorage.getItem(k); } return entries; })()`
      : `(() => { const entries = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); entries[k] = localStorage.getItem(k); } return entries; })()`;
    const result = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
    }) as { result: { value: Record<string, string> } };
    return result.result.value || {};
  }

  async close(): Promise<void> {
    // Remove the safety-net exit handler
    if (this._exitHandler) {
      process.removeListener('exit', this._exitHandler);
      this._exitHandler = null;
    }
    try {
      await this.send('Browser.close');
    } catch { /* already dead */ }
    this.ws?.close();
    this.ws = null;
    if (this.chromeProc && this.chromeProc.pid) {
      killChromeTree(this.chromeProc.pid, this.profileDir);
      this.chromeProc = null;
    }
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 10000);
    });
  }

  private async waitForCdp(): Promise<string> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        // Get the page target (not the browser target)
        const resp = await fetch(`http://127.0.0.1:${this.port}/json`);
        const targets = await resp.json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
        const page = targets.find(t => t.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Chrome CDP did not become available within 10s');
  }
}

// --- Helpers ---

/**
 * Kill Chrome and all its subprocesses.
 * Uses taskkill /T on Windows (kills process tree).
 * Uses pkill matching the user-data-dir on macOS/Linux (reliable for Chrome subprocesses).
 * Fallback: direct SIGKILL on the main PID.
 */
function killChromeTree(pid: number | undefined, profileDir: string): void {
  if (!pid) return;
  try {
    if (platform() === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      // Kill all processes using this profile directory (Chrome passes it to all subprocesses)
      try { execSync(`pkill -f "${profileDir}"`, { stdio: 'ignore' }); } catch {}
      // Fallback: kill main PID
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  } catch { /* already dead */ }
}

function getUserChromeProfileDir(): string {
  const p = platform();
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (p === 'darwin') return join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  if (p === 'win32') return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  // Linux
  return join(home, '.config', 'google-chrome');
}

function findChrome(): string | null {
  const p = platform();

  if (p === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    for (const candidate of paths) {
      if (existsSync(candidate)) return candidate;
    }
  } else if (p === 'win32') {
    // Build list of all known Chrome/Edge locations on Windows
    const envDirs = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
      `${process.env.USERPROFILE}\\AppData\\Local`,
    ].filter(Boolean) as string[];

    const relativePaths = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Google\\Chrome SxS\\Application\\chrome.exe',        // Chrome Canary
      'Microsoft\\Edge\\Application\\msedge.exe',            // Edge (Chromium)
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'Chromium\\Application\\chrome.exe',
    ];

    // Also try fixed well-known paths
    const fixedPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];

    // Combine: env-based + fixed
    const allPaths = [
      ...envDirs.flatMap(dir => relativePaths.map(rel => join(dir, rel))),
      ...fixedPaths,
    ];

    for (const candidate of allPaths) {
      if (existsSync(candidate)) return candidate;
    }

    // Last resort: check if 'chrome' or 'msedge' is in PATH
    try { const r = execSync('where chrome', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); if (r) return r.split('\n')[0]; } catch {}
    try { const r = execSync('where msedge', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); if (r) return r.split('\n')[0]; } catch {}
  } else {
    // Linux
    const cmds = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium', 'microsoft-edge'];
    for (const cmd of cmds) {
      try { return execSync(`which ${cmd}`, { encoding: 'utf8' }).trim(); } catch {}
    }
  }

  return null;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else reject(new Error('Could not get port'));
    });
  });
}

interface AXNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  children?: string[];
  parentId?: string;
}

function formatAXTree(nodes: AXNode[]): string {
  if (!nodes || nodes.length === 0) return '(empty)';
  const lines: string[] = [];
  // Build parent->children map
  const childMap = new Map<string, string[]>();
  const nodeMap = new Map<string, AXNode>();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
    if (node.parentId) {
      const children = childMap.get(node.parentId) || [];
      children.push(node.nodeId);
      childMap.set(node.parentId, children);
    }
  }

  function walk(id: string, depth: number) {
    const node = nodeMap.get(id);
    if (!node) return;
    const role = node.role?.value || '';
    const name = node.name?.value || '';
    if (role && role !== 'none' && role !== 'generic') {
      const indent = '  '.repeat(depth);
      const nameStr = name ? ` "${name}"` : '';
      lines.push(`${indent}- ${role}${nameStr}`);
    }
    const children = childMap.get(id) || [];
    for (const childId of children) {
      walk(childId, depth + (role && role !== 'none' && role !== 'generic' ? 1 : 0));
    }
  }

  // Find root (node without parentId)
  const root = nodes.find(n => !n.parentId);
  if (root) walk(root.nodeId, 0);
  return lines.join('\n') || '(empty)';
}
