import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from './session.js';

describe('SessionManager', () => {
  let workDir: string;
  let sm: SessionManager;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'bda-test-'));
    sm = new SessionManager(workDir);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test('create and get session', async () => {
    const session = await sm.create('playwright');
    assert.equal(session.status, 'active');
    assert.equal(session.backend, 'playwright');
    assert.ok(session.id.length === 8);

    const retrieved = await sm.get(session.id);
    assert.deepEqual(retrieved, session);
  });

  test('list sessions', async () => {
    await sm.create('playwright');
    await sm.create('playwright');
    const list = await sm.list();
    assert.equal(list.length, 2);
  });

  test('stop session', async () => {
    const session = await sm.create('playwright');
    await sm.stop(session.id);
    const retrieved = await sm.get(session.id);
    assert.equal(retrieved?.status, 'stopped');
  });

  test('cleanup removes session directory', async () => {
    const session = await sm.create('playwright');
    await sm.cleanup(session.id);
    const retrieved = await sm.get(session.id);
    assert.equal(retrieved, null);
  });

  test('list returns empty for fresh directory', async () => {
    const list = await sm.list();
    assert.equal(list.length, 0);
  });
});

describe('SessionManager lifecycle reconciliation', () => {
  test('reconcile marks sessions whose process is gone as crashed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bda-session-'));
    const sm = new SessionManager(dir);
    const live = await sm.create('chrome-cdp');
    const dead = await sm.create('chrome-cdp');

    const changed = await sm.reconcile((m) => m.id === live.id);
    assert.equal(changed, 1);
    assert.equal((await sm.get(live.id))!.status, 'active');
    assert.equal((await sm.get(dead.id))!.status, 'crashed');

    await rm(dir, { recursive: true, force: true });
  });

  test('cleanupFinished removes stopped and crashed, keeps active', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bda-session-'));
    const sm = new SessionManager(dir);
    const active = await sm.create('chrome-cdp');
    const stopped = await sm.create('chrome-cdp');
    await sm.stop(stopped.id);
    const crashed = await sm.create('chrome-cdp');
    await sm.update(crashed.id, { status: 'crashed' });

    assert.equal(await sm.cleanupFinished(), 2);
    assert.deepEqual((await sm.list()).map(s => s.id), [active.id]);

    await rm(dir, { recursive: true, force: true });
  });
});
