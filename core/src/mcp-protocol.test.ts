import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), 'mcp-server.js');

/**
 * Drive the server over real stdio and collect one response per line.
 * Regression guard: an unknown method used to throw and kill the process,
 * silently dropping every request that followed.
 */
function rpc(requests: object[], timeoutMs = 20_000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout; stderr=${stderr}`)); }, timeoutMs);

    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('exit', () => {
      clearTimeout(timer);
      const lines = out.split('\n').filter(Boolean);
      try {
        resolve(lines.map(l => JSON.parse(l)));
      } catch (e) {
        reject(new Error(`bad output: ${out}\nstderr=${stderr}`));
      }
    });

    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n');
    child.stdin.end();
  });
}

describe('MCP protocol', () => {
  test('unknown method returns an error instead of crashing the server', async () => {
    const res = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'bogus/method' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);

    const err = res.find(r => r.id === 1);
    assert.ok(err, 'no response for the unknown method');
    assert.equal((err!.error as { code: number }).code, -32601);

    // The critical part: the server survived and still served the next request.
    const list = res.find(r => r.id === 2);
    assert.ok(list, 'server died after an unknown method');
    assert.ok(Array.isArray((list!.result as { tools: unknown[] }).tools));
  });

  test('answers the standard handshake probes hosts send', async () => {
    const res = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      { jsonrpc: '2.0', id: 2, method: 'prompts/list' },
    ]);
    assert.deepEqual((res.find(r => r.id === 1)!.result as object), { resources: [] });
    assert.deepEqual((res.find(r => r.id === 2)!.result as object), { prompts: [] });
  });

  test('initialize reports the real package version', async () => {
    const res = await rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
    const info = (res[0].result as { serverInfo: { version: string } }).serverInfo;
    assert.notEqual(info.version, '0.1.0', 'version is still hardcoded');
    assert.match(info.version, /^\d+\.\d+\.\d+/);
  });

  test('a tool error is reported without killing the server', async () => {
    const res = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_snapshot', arguments: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const call = res.find(r => r.id === 1)!;
    assert.equal((call.result as { isError: boolean }).isError, true);
    assert.ok(res.find(r => r.id === 2), 'server died after a tool error');
  });
});
