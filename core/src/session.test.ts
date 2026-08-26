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
