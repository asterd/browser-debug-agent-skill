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
import { PlaywrightAdapter } from './adapters/playwright.js';
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
    description: 'Open a URL in an isolated browser session with optional viewport',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        width: { type: 'number', description: 'Viewport width (default: 1280)' },
        height: { type: 'number', description: 'Viewport height (default: 720)' },
        headless: { type: 'boolean', description: 'Run headless (default: true)' },
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
];

function init() {
  sessionManager = new SessionManager();
  serverManager = new ServerManager();
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'browser_doctor': {
      const sessions = await sessionManager.list();
      return {
        node: process.version,
        activeSessions: sessions.filter(s => s.status === 'active').length,
        status: 'ok',
      };
    }

    case 'browser_open': {
      if (adapter) await adapter.close().catch(() => {});
      adapter = new PlaywrightAdapter();
      const session = await sessionManager.create('playwright');
      currentSessionId = session.id;
      evidence = new Evidence(session.id, session.artifactDir, 'playwright');

      await adapter.open(args.url as string, {
        viewport: { width: (args.width as number) || 1280, height: (args.height as number) || 720 },
        headless: args.headless !== false,
      });

      await evidence.emit('open', { url: args.url });
      await sessionManager.update(session.id, { url: args.url as string, browserOwned: true });
      return { sessionId: session.id, url: args.url };
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
      return registered;
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

  rl.on('line', async (line) => {
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
}

// Start if this module is the entry point
const isMain = process.argv[1]?.endsWith('mcp-server.js');
if (isMain) {
  startServer();
}

export { startServer };
