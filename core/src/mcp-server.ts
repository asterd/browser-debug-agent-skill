/**
 * MCP Server for browser-debug-agent.
 * Exposes browser orchestration as structured tools for Kiro.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard transport).
 */
import { createInterface } from 'node:readline';
import { SessionManager } from './session.js';
import { ServerManager } from './server.js';
import { Evidence } from './evidence.js';
import { verify } from './verify.js';
import { createAdapter, listBackends } from './adapters/factory.js';
import type { BackendName } from './adapters/factory.js';
import type { BrowserAdapter, VerifyManifest } from './types.js';

// State
let sessionManager: SessionManager;
let serverManager: ServerManager;
let adapter: BrowserAdapter | null = null;
let evidence: Evidence | null = null;
let currentSessionId: string | null = null;

const TOOLS = [
  {
    name: 'browser_doctor',
    description: 'Check available browser runtimes and environment health',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_open',
    description: 'Open a URL in a browser session. Default: headless + isolated profile. Use visible:true to watch, profile:"user" for authenticated sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        width: { type: 'number', description: 'Viewport width (default: 1280)' },
        height: { type: 'number', description: 'Viewport height (default: 720)' },
        headless: { type: 'boolean', description: 'Run headless (default: true). Set false to see the browser.' },
        visible: { type: 'boolean', description: 'Shortcut: visible=true means headless=false' },
        profile: { type: 'string', enum: ['isolated', 'user', 'custom'], description: 'isolated (default): clean profile. user: real Chrome profile with cookies/login. custom: provide userDataDir.' },
        userDataDir: { type: 'string', description: 'Custom Chrome user-data-dir (only with profile: custom)' },
        backend: { type: 'string', enum: ['chrome-cdp', 'playwright'], description: 'Browser backend (default: chrome-cdp)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Capture an accessibility snapshot of the current page',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_interact',
    description: 'Perform a browser interaction (click, fill, press, hover)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['click', 'fill', 'press', 'hover', 'select'] },
        selector: { type: 'string', description: 'CSS selector or ref' },
        value: { type: 'string', description: 'Value for fill/select' },
        key: { type: 'string', description: 'Key for press' },
      },
      required: ['type', 'selector'],
    },
  },
  {
    name: 'browser_console',
    description: 'Get console log entries from the current browser session',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_network',
    description: 'Get network request/response entries from the current session',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page or a specific element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector to screenshot' },
        fullPage: { type: 'boolean', description: 'Capture full page (default: false)' },
      },
      required: [],
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Evaluate a JavaScript expression in the page context',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JS expression to evaluate' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_verify',
    description: 'Run a set of deterministic verification assertions against the page',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        assertions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              expect: {},
              label: { type: 'string' },
            },
            required: ['type', 'expect'],
          },
        },
      },
      required: ['url', 'assertions'],
    },
  },
  {
    name: 'browser_stop',
    description: 'Close the current browser session and clean up resources',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate to a different URL in the current session',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_resize',
    description: 'Resize the browser viewport (useful for responsive testing)',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Viewport width' },
        height: { type: 'number', description: 'Viewport height' },
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a CSS selector to appear in the DOM',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 5000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_cookies',
    description: 'Get all cookies for the current page (useful to inspect auth state)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_set_cookie',
    description: 'Set a cookie (useful for injecting auth tokens)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'string' },
        domain: { type: 'string' },
        path: { type: 'string' },
        secure: { type: 'boolean' },
        httpOnly: { type: 'boolean' },
      },
      required: ['name', 'value', 'domain'],
    },
  },
  {
    name: 'browser_local_storage',
    description: 'Get all localStorage entries for the current page',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function init() {
  sessionManager = new SessionManager();
  serverManager = new ServerManager();
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'browser_doctor': {
      const sessions = await sessionManager.list();
      const backends = await listBackends();
      return {
        node: process.version,
        activeSessions: sessions.filter(s => s.status === 'active').length,
        backends: backends.map(b => ({ name: b.name, available: b.available, description: b.description })),
        status: 'ok',
      };
    }

    case 'browser_open': {
      if (adapter) await adapter.close().catch(() => {});
      const backend = (args.backend as BackendName) || 'chrome-cdp';
      const newAdapter = await createAdapter(backend);
      const session = await sessionManager.create(backend);
      currentSessionId = session.id;
      evidence = new Evidence(session.id, session.artifactDir, backend);

      // visible=true is a shortcut for headless=false
      const headless = args.visible === true ? false : (args.headless !== false);

      try {
        await newAdapter.open(args.url as string, {
          viewport: { width: (args.width as number) || 1280, height: (args.height as number) || 720 },
          headless,
          profile: (args.profile as 'isolated' | 'user' | 'custom') || 'isolated',
          userDataDir: args.userDataDir as string | undefined,
        });
        adapter = newAdapter;
      } catch (err) {
        await newAdapter.close().catch(() => {});
        await sessionManager.update(session.id, { status: 'crashed' });
        currentSessionId = null;
        evidence = null;
        throw err;
      }

      const mode = headless ? 'headless' : 'visible';
      const profileMode = (args.profile as string) || 'isolated';
      await evidence.emit('open', { url: args.url, backend, mode, profile: profileMode });
      await sessionManager.update(session.id, { url: args.url as string, browserOwned: true });
      return { sessionId: session.id, url: args.url, backend, mode, profile: profileMode };
    }

    case 'browser_snapshot': {
      requireAdapter();
      const snap = await adapter!.snapshot();
      await evidence!.emit('snapshot', { treeLength: snap.tree.length });
      return snap;
    }

    case 'browser_interact': {
      requireAdapter();
      const result = await adapter!.interact({
        type: args.type as 'click' | 'fill' | 'press' | 'hover' | 'select',
        selector: args.selector as string,
        value: args.value as string | undefined,
        key: args.key as string | undefined,
      });
      await evidence!.emit('interact', { action: args, result });
      return result;
    }

    case 'browser_console': {
      requireAdapter();
      const entries = await adapter!.console();
      await evidence!.emit('console', { count: entries.length });
      return entries;
    }

    case 'browser_network': {
      requireAdapter();
      const entries = await adapter!.network();
      await evidence!.emit('network', { count: entries.length });
      return entries;
    }

    case 'browser_screenshot': {
      requireAdapter();
      const artifact = await adapter!.screenshot({
        selector: args.selector as string | undefined,
        fullPage: args.fullPage as boolean | undefined,
      });
      const registered = await evidence!.registerArtifact(artifact.path, artifact.mediaType);
      await evidence!.emit('screenshot', registered, { artifacts: [registered] });
      // Read the PNG and return as base64 for inline display in chat
      const { readFile: readFileFs } = await import('node:fs/promises');
      const imageData = await readFileFs(artifact.path);
      const base64 = imageData.toString('base64');
      // Return special marker so handleRequest sends image content
      return { _screenshot: true, base64, path: artifact.path, digest: registered.digest };
    }

    case 'browser_evaluate': {
      requireAdapter();
      const result = await adapter!.evaluate(args.expression as string);
      await evidence!.emit('evaluate', { expression: args.expression, result });
      return result;
    }

    case 'browser_verify': {
      requireAdapter();
      const manifest: VerifyManifest = {
        url: args.url as string,
        assertions: args.assertions as VerifyManifest['assertions'],
      };
      const results = await verify(adapter!, manifest);
      await evidence!.emit('verify', results);
      return results;
    }

    case 'browser_navigate': {
      requireAdapter();
      await adapter!.navigate(args.url as string);
      await evidence!.emit('navigate', { url: args.url });
      return { ok: true, url: args.url };
    }

    case 'browser_resize': {
      requireAdapter();
      await adapter!.resize(args.width as number, args.height as number);
      await evidence!.emit('resize', { width: args.width, height: args.height });
      return { ok: true, width: args.width, height: args.height };
    }

    case 'browser_reload': {
      requireAdapter();
      await adapter!.reload();
      await evidence!.emit('reload');
      return { ok: true };
    }

    case 'browser_wait': {
      requireAdapter();
      const found = await adapter!.waitFor(args.selector as string, (args.timeout as number) || 5000);
      await evidence!.emit('wait', { selector: args.selector, found });
      return { found, selector: args.selector };
    }

    case 'browser_cookies': {
      requireAdapter();
      const cookies = await adapter!.cookies();
      await evidence!.emit('cookies', { count: cookies.length });
      // Redact cookie values in evidence but return full cookies to agent
      return cookies;
    }

    case 'browser_set_cookie': {
      requireAdapter();
      await adapter!.setCookie({
        name: args.name as string,
        value: args.value as string,
        domain: args.domain as string,
        path: (args.path as string) || '/',
        secure: args.secure as boolean | undefined,
        httpOnly: args.httpOnly as boolean | undefined,
      });
      await evidence!.emit('set_cookie', { name: args.name, domain: args.domain });
      return { ok: true };
    }

    case 'browser_local_storage': {
      requireAdapter();
      const storage = await adapter!.localStorage();
      await evidence!.emit('localStorage', { count: Object.keys(storage).length });
      return storage;
    }

    case 'browser_stop': {
      if (adapter) {
        await adapter.close();
        adapter = null;
      }
      if (currentSessionId) {
        await sessionManager.stop(currentSessionId);
        currentSessionId = null;
      }
      evidence = null;
      return { stopped: true };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function requireAdapter(): void {
  if (!adapter) throw new Error('No browser session active. Call browser_open first.');
}

// --- JSON-RPC transport ---

async function handleRequest(req: { id: unknown; method: string; params?: unknown }): Promise<unknown> {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'browser-debug-agent', version: '0.1.0' },
      };

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call': {
      const { name, arguments: args } = (req.params as { name: string; arguments: Record<string, unknown> });
      try {
        const result = await handleToolCall(name, args || {});
        // Screenshot returns image content for inline display
        if (result && typeof result === 'object' && (result as Record<string, unknown>)._screenshot) {
          const ss = result as { base64: string; path: string; digest: string };
          return {
            content: [
              { type: 'image', data: ss.base64, mimeType: 'image/png' },
              { type: 'text', text: `Screenshot saved: ${ss.path}` },
            ],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err}` }], isError: true };
      }
    }

    case 'notifications/initialized':
      return undefined; // no response needed for notifications

    default:
      throw new Error(`Method not found: ${req.method}`);
  }
}

function startServer() {
  init();
  const rl = createInterface({ input: process.stdin });

  // Graceful shutdown: close browser on SIGTERM/SIGINT
  const shutdown = async () => {
    if (adapter) {
      await adapter.close().catch(() => {});
      adapter = null;
    }
    if (currentSessionId) {
      await sessionManager.stop(currentSessionId).catch(() => {});
      currentSessionId = null;
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  // When stdin closes, wait for pending operations then shut down
  rl.on('close', () => {
    queue.then(shutdown);
  });

  // Process messages sequentially (critical: browser_open must complete before snapshot)
  let queue: Promise<void> = Promise.resolve();

  rl.on('line', (line) => {
    queue = queue.then(async () => {
      let parsed: { id?: unknown; method: string; params?: unknown };
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }

      // Notifications (no id) don't get responses
      if (parsed.id === undefined) {
        await handleRequest({ id: null, method: parsed.method, params: parsed.params });
        return;
      }

      const req = parsed as { id: unknown; method: string; params?: unknown };
      const result = await handleRequest(req);

      const response = {
        jsonrpc: '2.0',
        id: req.id,
        result,
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    });
  });
}

// Start if this module is the entry point
const isMain = process.argv[1]?.endsWith('mcp-server.js');
if (isMain) {
  startServer();
}

export { startServer };
