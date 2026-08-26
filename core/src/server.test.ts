import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { ServerManager } from './server.js';

describe('ServerManager', () => {
  let server: Server | null = null;
  const mgr = new ServerManager();

  afterEach(() => {
    server?.close();
    server = null;
    mgr.stopAll();
  });

  test('attach to running server', async () => {
    // Start a simple HTTP server
    server = createServer((_, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    const info = await mgr.attach(url);
    assert.equal(info.url, url);
    assert.equal(info.owned, false);
  });

  test('attach to unreachable server throws', async () => {
    await assert.rejects(
      () => mgr.attach('http://127.0.0.1:19999', 1000),
      /not reachable/,
    );
  });

  test('stop returns false for unknown PID', () => {
    const result = mgr.stop(999999);
    assert.equal(result, false);
  });

  test('discover returns null without package.json', async () => {
    const result = await mgr.discover('/tmp/nonexistent-dir-xyz');
    assert.equal(result, null);
  });
});
