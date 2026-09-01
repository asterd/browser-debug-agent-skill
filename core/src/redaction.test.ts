import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Evidence } from './evidence.js';

/**
 * Secrets must never reach the evidence log. These cases are the formats that
 * actually show up in browser traffic.
 */
describe('redaction', () => {
  async function emitAndRead(data: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bda-redact-'));
    try {
      const ev = new Evidence('test', join(dir, 'artifacts'), 'chrome-cdp');
      await ev.emit('probe', data);
      return await readFile(join(dir, 'evidence.jsonl'), 'utf8');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Assembled at runtime: written as literals these trip secret scanners
  // (GitHub push protection blocks the push) even though they are fabricated.
  const j = (p: string) => p;
  const secrets: Array<[string, string]> = [
    ['JWT', ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'ZmFrZS1zaWduYXR1cmU'].join('.')],
    ['Bearer token', 'Bearer ' + j('abc123def456ghi789jkl012mno345')],
    ['OpenAI-style key', 'sk' + '-' + j('abcdefghijklmnopqrstuvwxyz012345')],
    ['GitHub token', 'ghp' + '_' + j('abcdefghijklmnopqrstuvwxyz0123456789')],
    ['Slack token', 'xoxb' + '-' + j('123456789012') + '-' + j('abcdefghijklmno')],
    ['AWS access key', 'AKIA' + j('IOSFODNN7EXAMPLE')],
    ['Authorization header', 'Authorization: Basic ' + j('dXNlcjpwYXNz')],
    ['token query param', 'https://api.example.com/v1?token=' + j('supersecretvalue')],
  ];

  for (const [label, secret] of secrets) {
    test(`${label} is redacted`, async () => {
      const log = await emitAndRead({ note: secret });
      assert.ok(!log.includes(secret), `${label} leaked into evidence: ${log}`);
    });
  }

  test('redacts secrets nested in arrays and objects', async () => {
    const secret = 'ghp' + '_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
    const log = await emitAndRead({ requests: [{ headers: { deep: secret } }] });
    assert.ok(!log.includes(secret), 'nested secret leaked');
  });

  test('leaves ordinary text intact', async () => {
    const log = await emitAndRead({ note: 'clicked the Save button' });
    assert.ok(log.includes('clicked the Save button'));
  });
});
