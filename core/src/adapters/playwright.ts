import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import type {
  BrowserAdapter, OpenOpts, SnapshotResult,
  InteractAction, InteractResult, ConsoleEntry,
  NetworkEntry, ScreenshotOpts, Artifact, CookieEntry,
} from '../types.js';

const execFileP = promisify(execFile);

/**
 * Adapter that drives a Playwright-controlled Chromium via a helper script.
 * Uses @playwright/test's programmatic API through a child Node process.
 */
export class PlaywrightAdapter implements BrowserAdapter {
  readonly name = 'playwright';
  private helperProc: ReturnType<typeof spawn> | null = null;
  private profileDir: string = '';
  private pendingResolves = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private msgId = 0;
  private buffer = '';
  private consoleEntries: ConsoleEntry[] = [];
  private networkEntries: NetworkEntry[] = [];

  async version(): Promise<string> {
    try {
      const { stdout } = await execFileP('npx', ['playwright', '--version'], { timeout: 10000 });
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  async open(url: string, opts?: OpenOpts): Promise<void> {
    this.profileDir = join(tmpdir(), `bda-pw-${Date.now()}`);
    await mkdir(this.profileDir, { recursive: true });

    const viewport = opts?.viewport ?? { width: 1280, height: 720 };
    const headless = opts?.headless ?? true;

    // Resolve playwright module path for the helper
    const playwrightPath = await this.resolvePlaywright();

    // Write helper script in the profile dir but run it with cwd = project root
    // so that ESM module resolution finds playwright in node_modules
    const helperPath = join(this.profileDir, '_helper.mjs');
    await writeFile(helperPath, this.helperScript(playwrightPath));

    this.helperProc = spawn('node', [helperPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_PATH: [
          join(process.cwd(), 'node_modules'),
          process.env.NODE_PATH || '',
        ].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
      },
    });

    // Collect stderr for diagnostics
    let stderrBuf = '';
    this.helperProc.stderr!.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString(); });
    this.helperProc.on('exit', (code) => {
      if (code && code !== 0 && stderrBuf) {
        process.stderr.write(`[bda:playwright-helper] ${stderrBuf}\n`);
      }
    });

    this.helperProc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.handleMessage(line);
      }
    });

    await this.call('launch', { headless, viewport, url });
  }

  private async resolvePlaywright(): Promise<string> {
    // Try to find playwright in common locations
    const candidates = [
      join(process.cwd(), 'node_modules', 'playwright'),
      join(process.cwd(), 'node_modules', '@playwright', 'test'),
      join(process.cwd(), 'node_modules', 'playwright-core'),
    ];
    for (const candidate of candidates) {
      try {
        await import('node:fs/promises').then(fs => fs.access(candidate));
        return candidate;
      } catch { /* next */ }
    }
    // Fallback: assume it's globally resolvable
    return 'playwright';
  }

  async snapshot(): Promise<SnapshotResult> {
    const result = await this.call('snapshot') as { tree: string; refs: Record<string, string> };
    return result;
  }

  async interact(action: InteractAction): Promise<InteractResult> {
    const result = await this.call('interact', action) as InteractResult;
    return result;
  }

  async evaluate(expr: string): Promise<unknown> {
    return this.call('evaluate', { expr });
  }

  async console(): Promise<ConsoleEntry[]> {
    const entries = await this.call('console') as ConsoleEntry[];
    return [...this.consoleEntries, ...entries];
  }

  async network(): Promise<NetworkEntry[]> {
    const entries = await this.call('network') as NetworkEntry[];
    return [...this.networkEntries, ...entries];
  }

  async screenshot(opts?: ScreenshotOpts): Promise<Artifact> {
    const path = opts?.path ?? join(this.profileDir, `screenshot-${Date.now()}.png`);
    await this.call('screenshot', { path, fullPage: opts?.fullPage, selector: opts?.selector });
    return { path, mediaType: 'image/png' };
  }

  async navigate(url: string): Promise<void> { await this.call('navigate', { url }); }
  async resize(width: number, height: number): Promise<void> { await this.call('resize', { width, height }); }
  async reload(): Promise<void> { await this.call('reload'); }
  async waitFor(selector: string, timeout = 5000): Promise<boolean> {
    try { await this.call('waitFor', { selector, timeout }); return true; } catch { return false; }
  }
  async cookies(): Promise<CookieEntry[]> { return await this.call('cookies') as CookieEntry[]; }
  async setCookie(cookie: CookieEntry): Promise<void> { await this.call('setCookie', cookie); }
  async localStorage(): Promise<Record<string, string>> { return await this.call('localStorage') as Record<string, string>; }

  async close(): Promise<void> {
    try {
      await this.call('close');
    } catch { /* helper may already be dead */ }
    this.helperProc?.kill();
    this.helperProc = null;
  }

  private call(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pendingResolves.set(id, { resolve, reject });
      const msg = JSON.stringify({ id, method, params }) + '\n';
      this.helperProc?.stdin!.write(msg);

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingResolves.has(id)) {
          this.pendingResolves.delete(id);
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, 30000);
    });
  }

  private handleMessage(line: string): void {
    try {
      const msg = JSON.parse(line) as { id: number; result?: unknown; error?: string };
      const pending = this.pendingResolves.get(msg.id);
      if (pending) {
        this.pendingResolves.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result);
      }
    } catch { /* ignore malformed lines */ }
  }

  /**
   * The helper script runs in a child process with Playwright.
   * It communicates via JSON lines over stdin/stdout.
   * Uses createRequire to resolve playwright from the project's node_modules.
   */
  private helperScript(playwrightPath: string): string {
    // Pass both the project cwd AND the package's own location for resolution
    const projectCwd = process.cwd().replace(/\\/g, '\\\\');
    // Get the package root directory (one level up from dist/adapters/)
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageDir = resolve(currentDir, '..', '..').replace(/\\/g, '\\\\');
    return `
import { createInterface } from 'readline';
import { createRequire } from 'module';
import { join } from 'path';

// Try multiple resolution roots:
// 1. User's project (if they have playwright installed)
// 2. The browser-debug-agent package itself (global install may have it)
// 3. Global node_modules
const roots = [
  join('${projectCwd}', 'package.json'),
  join('${packageDir}', 'package.json'),
];

let chromium;
let loaded = false;
for (const root of roots) {
  if (loaded) break;
  try {
    const req = createRequire(root);
    for (const mod of ['playwright', '@playwright/test', 'playwright-core']) {
      try {
        const pw = req(mod);
        chromium = pw.chromium;
        if (chromium) { loaded = true; break; }
      } catch {}
    }
  } catch {}
}

if (!chromium) {
  process.stderr.write('Cannot load playwright. Install it: npm install -D playwright\\n');
  process.exit(1);
}

let browser, context, page;
const consoleEntries = [];
const networkEntries = [];

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    const result = await handle(method, params || {});
    process.stdout.write(JSON.stringify({ id, result }) + '\\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ id, error: err.message }) + '\\n');
  }
});

async function handle(method, params) {
  switch (method) {
    case 'launch': {
      browser = await chromium.launch({ headless: params.headless });
      context = await browser.newContext({ viewport: params.viewport });
      page = await context.newPage();
      page.on('console', (msg) => {
        consoleEntries.push({ level: msg.type(), text: msg.text(), ts: new Date().toISOString() });
      });
      page.on('response', (resp) => {
        networkEntries.push({
          method: resp.request().method(),
          url: resp.url(),
          status: resp.status(),
        });
      });
      await page.goto(params.url, { waitUntil: 'domcontentloaded' });
      return { ok: true };
    }
    case 'snapshot': {
      let tree;
      try {
        // Playwright >= 1.50 uses ariaSnapshot on locators
        tree = await page.locator('body').ariaSnapshot();
      } catch {
        try {
          // Older Playwright
          tree = JSON.stringify(await page.accessibility.snapshot() || {});
        } catch {
          // Fallback: get text content
          tree = await page.evaluate(() => document.body.innerText);
        }
      }
      const refs = {};
      return { tree: typeof tree === 'string' ? tree : JSON.stringify(tree), refs };
    }
    case 'interact': {
      const { type, ref, selector, value, key } = params;
      const target = selector || ref;
      switch (type) {
        case 'click': await page.click(target); break;
        case 'fill': await page.fill(target, value); break;
        case 'press': await page.press(target || 'body', key); break;
        case 'hover': await page.hover(target); break;
        case 'select': await page.selectOption(target, value); break;
      }
      return { ok: true };
    }
    case 'evaluate': {
      const result = await page.evaluate(params.expr);
      return result;
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
      if (params.selector) {
        await page.locator(params.selector).screenshot(opts);
      } else {
        await page.screenshot(opts);
      }
      return { path: params.path };
    }
    case 'close': {
      await browser?.close();
      // Return result, then exit after a tick
      setTimeout(() => process.exit(0), 50);
      return { ok: true };
    }
  }
}
`;
  }
}
