/**
 * MCP Server for browser-debug-agent.
 * Exposes browser orchestration as structured tools for Kiro.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard transport).
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from './session.js';
import { Evidence } from './evidence.js';
import { verify } from './verify.js';
import { createAdapter, listBackends } from './adapters/factory.js';
import type { BackendName } from './adapters/factory.js';
import type { BrowserAdapter, VerifyManifest } from './types.js';

/** Real package version — keep the handshake honest. */
const VERSION: string = (() => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
})();

// State
let sessionManager: SessionManager;
let adapter: BrowserAdapter | null = null;
let evidence: Evidence | null = null;
let currentSessionId: string | null = null;

const TOOLS = [
  {
    name: 'browser_doctor',
    description: 'Environment health: runtimes available, active sessions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_open',
    description: 'Open a URL, or re-point the live session (navigate/resize/reload). Headless + isolated by default; visible:true to watch, profile:"user" for logged-in state.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        width: { type: 'number', description: 'default 1280' },
        height: { type: 'number', description: 'default 720' },
        headless: { type: 'boolean', description: 'default true' },
        visible: { type: 'boolean', description: 'alias for headless:false' },
        reload: { type: 'boolean' },
        profile: { type: 'string', enum: ['isolated', 'user', 'custom'], description: 'user = real Chrome profile (needs consent)' },
        userDataDir: { type: 'string', description: 'with profile:custom' },
        backend: { type: 'string', enum: ['chrome-cdp', 'playwright'] },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Accessibility tree of the page: structure, roles and text.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_interact',
    description: 'Click, fill, press, hover or select an element.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['click', 'fill', 'press', 'hover', 'select'] },
        selector: { type: 'string', description: 'CSS selector' },
        value: { type: 'string', description: 'for fill/select' },
        key: { type: 'string', description: 'for press' },
      },
      required: ['type', 'selector'],
    },
  },
  {
    name: 'browser_console',
    description: 'Console entries since the session opened.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_network',
    description: 'Network requests with method, url and status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_screenshot',
    description: 'Screenshot the page or one element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        fullPage: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Evaluate a JS expression in the page.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_verify',
    description: 'Run deterministic assertions (console_errors, network_status, visible, js, snapshot_contains). Use this to prove a fix.',
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
    description: 'Close the session and clean up.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a selector to appear.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        timeout: { type: 'number', description: 'ms, default 5000' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_state',
    description: 'Read cookies/localStorage, or set a cookie. Credential-like values are masked unless reveal:true.',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['cookies', 'localStorage'], description: 'default cookies' },
        set: {
          type: 'object',
          description: 'set a cookie; needs name, value, domain',
          properties: {
            name: { type: 'string' },
            value: { type: 'string' },
            domain: { type: 'string' },
            path: { type: 'string' },
            secure: { type: 'boolean' },
            httpOnly: { type: 'boolean' },
          },
        },
        reveal: { type: 'boolean', description: 'raw values; needs user consent' },
      },
      required: [],
    },
  },
];

function init() {
  sessionManager = new SessionManager();
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
      // Reuse a live session for navigation/resize/reload instead of paying a
      // browser restart (and instead of shipping three more tools).
      if (adapter) {
        const wantsRestart = args.headless !== undefined || args.visible !== undefined
          || args.profile !== undefined || args.backend !== undefined;
        if (!wantsRestart) {
          if (args.width && args.height) await adapter.resize(args.width as number, args.height as number);
          if (args.reload === true) await adapter.reload();
          else if (args.url) await adapter.navigate(args.url as string);
          await evidence!.emit('open', { url: args.url, reused: true, reload: args.reload === true });
          return { sessionId: currentSessionId, url: args.url, reused: true };
        }
        await adapter.close().catch(() => {});
      }
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

    case 'browser_state': {
      requireAdapter();
      const reveal = args.reveal === true;

      if (args.set) {
        const c = args.set as Record<string, unknown>;
        if (!c.name || !c.value || !c.domain) throw new Error('set requires name, value and domain');
        await adapter!.setCookie({
          name: c.name as string,
          value: c.value as string,
          domain: c.domain as string,
          path: (c.path as string) || '/',
          secure: c.secure as boolean | undefined,
          httpOnly: c.httpOnly as boolean | undefined,
        });
        await evidence!.emit('set_cookie', { name: c.name, domain: c.domain });
        return { ok: true };
      }

      if (args.what === 'localStorage') {
        const storage = await adapter!.localStorage();
        await evidence!.emit('localStorage', { count: Object.keys(storage).length, keys: Object.keys(storage) });
        if (reveal) return storage;
        return Object.fromEntries(
          Object.entries(storage).map(([k, v]) => [k, looksSecret(k) ? maskSecret(v) : v])
        );
      }

      const cookies = await adapter!.cookies();
      await evidence!.emit('cookies', { count: cookies.length, names: cookies.map(c => c.name) });
      return cookies.map(c => reveal ? c : { ...c, value: maskSecret(c.value) });
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

/** Keep enough of a value to correlate it, never enough to replay it. */
function maskSecret(value: string): string {
  if (!value) return value;
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-2)} (${value.length} chars, masked)`;
}

const SECRET_KEY_RE = /token|auth|session|secret|password|jwt|credential|api[_-]?key/i;
function looksSecret(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

function requireAdapter(): void {
  if (!adapter) throw new Error('No browser session active. Call browser_open first.');
}

// --- JSON-RPC transport ---

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

async function handleRequest(req: { id: unknown; method: string; params?: unknown }): Promise<unknown> {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'browser-debug-agent', version: VERSION },
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

    // Hosts routinely probe these during handshake. We expose neither, but we
    // must answer: throwing here used to kill the server and drop every
    // subsequent request.
    case 'resources/list':
      return { resources: [] };
    case 'prompts/list':
      return { prompts: [] };
    case 'ping':
      return {};

    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${req.method}`);
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
        try { await handleRequest({ id: null, method: parsed.method, params: parsed.params }); } catch { /* notifications get no response */ }
        return;
      }

      const req = parsed as { id: unknown; method: string; params?: unknown };
      let response: Record<string, unknown>;
      try {
        response = { jsonrpc: '2.0', id: req.id, result: await handleRequest(req) };
      } catch (err) {
        const code = err instanceof RpcError ? err.code : INTERNAL_ERROR;
        response = { jsonrpc: '2.0', id: req.id, error: { code, message: String(err instanceof Error ? err.message : err) } };
      }
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
