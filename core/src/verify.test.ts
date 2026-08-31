import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from './verify.js';
import type { BrowserAdapter, VerifyManifest, ConsoleEntry, NetworkEntry, SnapshotResult, Artifact, InteractResult, CookieEntry } from './types.js';

// Minimal mock adapter for testing verify logic without a real browser.
function createMockAdapter(opts: {
  console?: ConsoleEntry[];
  network?: NetworkEntry[];
  snapshot?: SnapshotResult;
  evaluate?: unknown;
}): BrowserAdapter {
  return {
    name: 'mock',
    version: async () => '1.0.0',
    open: async () => {},
    snapshot: async () => opts.snapshot ?? { refs: {}, tree: '' },
    interact: async (): Promise<InteractResult> => ({ ok: true }),
    evaluate: async () => opts.evaluate ?? true,
    console: async () => opts.console ?? [],
    network: async () => opts.network ?? [],
    screenshot: async (): Promise<Artifact> => ({ path: '/tmp/test.png', mediaType: 'image/png' }),
    close: async () => {},
    navigate: async () => {},
    resize: async () => {},
    reload: async () => {},
    waitFor: async () => true,
    cookies: async (): Promise<CookieEntry[]> => [],
    setCookie: async () => {},
    localStorage: async () => ({}),
  };
}

describe('verify', () => {
  test('console_errors: pass when no errors', async () => {
    const adapter = createMockAdapter({ console: [] });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'console_errors', expect: 'none' }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'pass');
  });

  test('console_errors: fail when errors present', async () => {
    const adapter = createMockAdapter({
      console: [{ level: 'error', text: 'Uncaught TypeError' }],
    });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'console_errors', expect: 'none' }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results[0].status, 'fail');
    assert.deepEqual(results[0].actual, ['Uncaught TypeError']);
  });

  test('network_status: pass with no failed requests', async () => {
    const adapter = createMockAdapter({
      network: [{ method: 'GET', url: '/api/data', status: 200 }],
    });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'network_status', expect: { failed: 'none' } }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results[0].status, 'pass');
  });

  test('network_status: fail with 500 error', async () => {
    const adapter = createMockAdapter({
      network: [{ method: 'POST', url: '/api/save', status: 500 }],
    });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'network_status', expect: { failed: 'none' } }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results[0].status, 'fail');
  });

  test('visible: pass when text in snapshot', async () => {
    const adapter = createMockAdapter({
      snapshot: { refs: {}, tree: '{"role":"heading","name":"Settings"}' },
    });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'visible', expect: 'Settings' }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results[0].status, 'pass');
  });

  test('visible: fail when text missing', async () => {
    const adapter = createMockAdapter({
      snapshot: { refs: {}, tree: '{"role":"heading","name":"Dashboard"}' },
    });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'visible', expect: 'Settings' }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results[0].status, 'fail');
  });

  test('js: pass when expression is truthy', async () => {
    const adapter = createMockAdapter({ evaluate: true });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'js', expect: 'document.title.length > 0' }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results[0].status, 'pass');
  });

  test('js: fail when expression is falsy', async () => {
    const adapter = createMockAdapter({ evaluate: 0 });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [{ type: 'js', expect: 'document.querySelectorAll(".error").length === 0' }],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results[0].status, 'fail');
  });

  test('multiple assertions execute in order', async () => {
    const adapter = createMockAdapter({
      console: [],
      network: [{ method: 'GET', url: '/', status: 200 }],
      snapshot: { refs: {}, tree: '{"name":"Hello"}' },
    });
    const manifest: VerifyManifest = {
      url: 'http://localhost:3000',
      assertions: [
        { type: 'console_errors', expect: 'none' },
        { type: 'network_status', expect: { failed: 'none' } },
        { type: 'visible', expect: 'Hello' },
      ],
    };
    const results = await verify(adapter, manifest);
    assert.equal(results.length, 3);
    assert.ok(results.every(r => r.status === 'pass'));
  });
});
