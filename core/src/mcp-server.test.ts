import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'dist', 'mcp-server.js');

function startMcpServer(): ChildProcess {
  return spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sendRequest(proc: ChildProcess, req: object): Promise<object> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        proc.stdout!.off('data', onData);
        try {
          resolve(JSON.parse(buffer.slice(0, nl)));
        } catch (e) {
          reject(new Error(`Bad JSON: ${buffer.slice(0, nl)}`));
        }
      }
    };
    proc.stdout!.on('data', onData);
    proc.stdin!.write(JSON.stringify(req) + '\n');
    setTimeout(() => reject(new Error('MCP response timeout')), 5000);
  });
}

describe('MCP Server', () => {
  test('initialize returns server info', async () => {
    const proc = startMcpServer();
    try {
      const resp = await sendRequest(proc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }) as { result: { serverInfo: { name: string } } };

      assert.equal(resp.result.serverInfo.name, 'browser-debug-agent');
    } finally {
      proc.kill();
    }
  });

  test('tools/list returns all tools', async () => {
    const proc = startMcpServer();
    try {
      // Initialize first
      await sendRequest(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

      const resp = await sendRequest(proc, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }) as { result: { tools: Array<{ name: string }> } };

      const toolNames = resp.result.tools.map(t => t.name);
      assert.ok(toolNames.includes('browser_open'));
      assert.ok(toolNames.includes('browser_snapshot'));
      assert.ok(toolNames.includes('browser_interact'));
      assert.ok(toolNames.includes('browser_console'));
      assert.ok(toolNames.includes('browser_network'));
      assert.ok(toolNames.includes('browser_verify'));
      assert.ok(toolNames.includes('browser_stop'));
      assert.ok(toolNames.includes('browser_doctor'));
      assert.ok(toolNames.includes('browser_evaluate'));
      assert.ok(toolNames.includes('browser_screenshot'));
      assert.equal(toolNames.length, 10);
    } finally {
      proc.kill();
    }
  });

  test('browser_doctor returns status', async () => {
    const proc = startMcpServer();
    try {
      await sendRequest(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

      const resp = await sendRequest(proc, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'browser_doctor', arguments: {} },
      }) as { result: { content: Array<{ text: string }> } };

      const content = JSON.parse(resp.result.content[0].text);
      assert.equal(content.status, 'ok');
      assert.ok(content.node.startsWith('v'));
    } finally {
      proc.kill();
    }
  });

  test('browser_stop without session returns stopped', async () => {
    const proc = startMcpServer();
    try {
      await sendRequest(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

      const resp = await sendRequest(proc, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'browser_stop', arguments: {} },
      }) as { result: { content: Array<{ text: string }> } };

      const content = JSON.parse(resp.result.content[0].text);
      assert.equal(content.stopped, true);
    } finally {
      proc.kill();
    }
  });
});
