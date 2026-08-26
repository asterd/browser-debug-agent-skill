import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from './session.js';
import { Evidence } from './evidence.js';
import { verify } from './verify.js';
import type { BrowserAdapter, ConsoleEntry, NetworkEntry, SnapshotResult, Artifact, InteractResult, VerifyManifest } from './types.js';

/**
 * Integration test: demonstrates the full orchestrated loop
 * session → evidence → verify using a mock adapter.
 * This proves the orchestration works end-to-end without needing a real browser.
 */
describe('Integration: full loop', () => {
  test('session + evidence + verify pass scenario', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'bda-int-'));

    try {
      // 1. Create session
      const sm = new SessionManager(workDir);
      const session = await sm.create('mock', { url: 'http://localhost:3000' });
      assert.equal(session.status, 'active');

      // 2. Set up evidence
      const ev = new Evidence(session.id, session.artifactDir, 'mock');

      // 3. Mock adapter simulates a healthy page
      const adapter: BrowserAdapter = {
        name: 'mock',
        version: async () => '1.0.0',
        open: async () => { await ev.emit('open', { url: 'http://localhost:3000' }); },
        snapshot: async (): Promise<SnapshotResult> => ({ refs: {}, tree: '{"role":"heading","name":"Settings"}' }),
        interact: async (): Promise<InteractResult> => ({ ok: true }),
        evaluate: async () => true,
        console: async (): Promise<ConsoleEntry[]> => [],
        network: async (): Promise<NetworkEntry[]> => [{ method: 'POST', url: '/api/settings', status: 200 }],
        screenshot: async (): Promise<Artifact> => ({ path: '/tmp/test.png', mediaType: 'image/png' }),
        close: async () => {},
      };

      // 4. Run verification
      const manifest: VerifyManifest = {
        url: 'http://localhost:3000',
        assertions: [
          { type: 'visible', expect: 'Settings', label: 'Heading visible' },
          { type: 'console_errors', expect: 'none', label: 'No errors' },
          { type: 'network_status', expect: { failed: 'none' }, label: 'No failed requests' },
          { type: 'js', expect: 'document.title.length > 0', label: 'Title exists' },
        ],
      };

      const results = await verify(adapter, manifest);
      assert.ok(results.every(r => r.status === 'pass'));

      // 5. Record results
      for (const r of results) {
        await ev.emit('verify_assertion', r);
      }

      // 6. Stop session
      await sm.stop(session.id);
      const stopped = await sm.get(session.id);
      assert.equal(stopped?.status, 'stopped');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test('session + evidence + verify fail scenario', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'bda-int-'));

    try {
      const sm = new SessionManager(workDir);
      const session = await sm.create('mock');
      const ev = new Evidence(session.id, session.artifactDir, 'mock');

      // Simulates a broken page (bug: console error + wrong endpoint)
      const adapter: BrowserAdapter = {
        name: 'mock',
        version: async () => '1.0.0',
        open: async () => {},
        snapshot: async (): Promise<SnapshotResult> => ({ refs: {}, tree: '{"role":"heading","name":"Settings"}' }),
        interact: async (): Promise<InteractResult> => ({ ok: true }),
        evaluate: async () => false, // Status not 'Saved'
        console: async (): Promise<ConsoleEntry[]> => [{ level: 'error', text: 'Failed to fetch' }],
        network: async (): Promise<NetworkEntry[]> => [{ method: 'POST', url: '/api/settigns', status: 404 }],
        screenshot: async (): Promise<Artifact> => ({ path: '/tmp/test.png', mediaType: 'image/png' }),
        close: async () => {},
      };

      const manifest: VerifyManifest = {
        url: 'http://localhost:3000',
        assertions: [
          { type: 'visible', expect: 'Settings', label: 'Heading visible' },
          { type: 'console_errors', expect: 'none', label: 'No errors' },
          { type: 'network_status', expect: { failed: 'none' }, label: 'No failed requests' },
          { type: 'js', expect: 'document.getElementById("status").textContent === "Saved"', label: 'Status shows Saved' },
        ],
      };

      const results = await verify(adapter, manifest);

      // Heading pass, but console, network, and JS fail
      assert.equal(results[0].status, 'pass');
      assert.equal(results[1].status, 'fail');
      assert.equal(results[2].status, 'fail');
      assert.equal(results[3].status, 'fail');

      for (const r of results) {
        await ev.emit('verify_assertion', r);
      }

      await sm.stop(session.id);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
