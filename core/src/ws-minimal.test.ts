import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { WebSocket } from './adapters/ws-minimal.js';

/**
 * A tiny RFC6455 server: echoes what it receives, and can also push a
 * deliberately fragmented message. Enough to prove framing both ways.
 */
function startEchoServer(): Promise<{ server: Server; port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer();
    const sockets = new Set<Duplex>();
    server.on('upgrade', (req, socket: Duplex) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      const key = req.headers['sec-websocket-key'] as string;
      const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          const masked = (buf[1] & 0x80) !== 0;
          const maskKey = masked ? buf.subarray(off, off + 4) : null;
          if (masked) off += 4;
          if (buf.length < off + len) return;
          const payload = Buffer.from(buf.subarray(off, off + len));
          if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
          buf = buf.subarray(off + len);

          if (opcode === 0x01) {
            const text = payload.toString('utf8');
            if (text === '__fragmented__') sendFragmented(socket, 'part-one|part-two|part-three');
            else sendFrame(socket, payload);
          }
        }
      });
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: (server.address() as { port: number }).port,
        // Upgraded sockets keep the server (and the test process) alive.
        close: () => { for (const s of sockets) s.destroy(); server.close(); },
      });
    });
  });
}

function frameHeader(opcode: number, len: number, fin: boolean): Buffer {
  const first = (fin ? 0x80 : 0x00) | opcode;
  if (len < 126) return Buffer.from([first, len]);
  if (len < 65536) { const h = Buffer.alloc(4); h[0] = first; h[1] = 126; h.writeUInt16BE(len, 2); return h; }
  const h = Buffer.alloc(10); h[0] = first; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h;
}

function sendFrame(socket: Duplex, payload: Buffer): void {
  socket.write(Buffer.concat([frameHeader(0x01, payload.length, true), payload]));
}

/** Split across a text frame + continuation frames, as Chrome does for big messages. */
function sendFragmented(socket: Duplex, text: string): void {
  const parts = text.split('|').map(p => Buffer.from(p, 'utf8'));
  socket.write(Buffer.concat([frameHeader(0x01, parts[0].length, false), parts[0]]));
  for (let i = 1; i < parts.length; i++) {
    const last = i === parts.length - 1;
    socket.write(Buffer.concat([frameHeader(0x00, parts[i].length, last), parts[i]]));
  }
}

async function roundTrip(port: number, message: string): Promise<string> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
  await ws.connect();
  const got = new Promise<string>((resolve) => ws.onMessage(resolve));
  ws.send(message);
  const result = await got;
  ws.close();
  return result;
}

describe('ws-minimal framing', () => {
  test('round-trips a small payload', async () => {
    const { port, close } = await startEchoServer();
    try {
      assert.equal(await roundTrip(port, 'hello'), 'hello');
    } finally { close(); }
  });

  test('round-trips a payload needing 16-bit length (>125 bytes)', async () => {
    const { port, close } = await startEchoServer();
    try {
      const msg = 'a'.repeat(1000);
      assert.equal(await roundTrip(port, msg), msg);
    } finally { close(); }
  });

  test('round-trips a payload needing 64-bit length (>64KB)', async () => {
    // Regression: the daemon's inlined copy had no 127 branch and corrupted
    // frames this size, which killed the browser session.
    const { port, close } = await startEchoServer();
    try {
      const msg = 'x'.repeat(100_000);
      assert.equal((await roundTrip(port, msg)).length, msg.length);
    } finally { close(); }
  });

  test('reassembles a fragmented message', async () => {
    const { port, close } = await startEchoServer();
    try {
      assert.equal(await roundTrip(port, '__fragmented__'), 'part-onepart-twopart-three');
    } finally { close(); }
  });
});
