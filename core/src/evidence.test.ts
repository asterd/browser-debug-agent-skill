import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Evidence } from './evidence.js';

describe('Evidence', () => {
  let workDir: string;
  let artifactDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'bda-ev-'));
    artifactDir = join(workDir, 'artifacts');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test('emit writes JSONL', async () => {
    const ev = new Evidence('test-01', artifactDir, 'playwright');
    await ev.emit('open', { url: 'http://localhost:3000' });
    await ev.emit('snapshot', { tree: 'some tree' });

    const logPath = join(workDir, 'evidence.jsonl');
    const content = await readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0]);
    assert.equal(first.v, 1);
    assert.equal(first.session, 'test-01');
    assert.equal(first.seq, 1);
    assert.equal(first.command, 'open');
    assert.equal(first.ok, true);
  });

  test('redacts Authorization headers', async () => {
    const ev = new Evidence('test-02', artifactDir, 'playwright');
    await ev.emit('network', { headers: 'Authorization: Bearer secret123' });

    const logPath = join(workDir, 'evidence.jsonl');
    const content = await readFile(logPath, 'utf8');
    const event = JSON.parse(content.trim());

    assert.ok(!content.includes('secret123'));
    assert.ok(content.includes('[REDACTED]'));
    assert.ok(event.redactions.length > 0);
  });

  test('redacts cookies', async () => {
    const ev = new Evidence('test-03', artifactDir, 'playwright');
    await ev.emit('request', { header: 'Cookie: session=abc123def' });

    const logPath = join(workDir, 'evidence.jsonl');
    const content = await readFile(logPath, 'utf8');
    assert.ok(!content.includes('abc123def'));
  });

  test('redacts token query params', async () => {
    const ev = new Evidence('test-04', artifactDir, 'playwright');
    await ev.emit('url', { href: 'http://example.com?token=mysecrettoken&other=safe' });

    const logPath = join(workDir, 'evidence.jsonl');
    const content = await readFile(logPath, 'utf8');
    assert.ok(!content.includes('mysecrettoken'));
  });

  test('increments sequence numbers', async () => {
    const ev = new Evidence('test-05', artifactDir, 'playwright');
    const e1 = await ev.emit('a');
    const e2 = await ev.emit('b');
    const e3 = await ev.emit('c');
    assert.equal(e1.seq, 1);
    assert.equal(e2.seq, 2);
    assert.equal(e3.seq, 3);
  });
});
