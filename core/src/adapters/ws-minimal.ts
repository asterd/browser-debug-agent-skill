/**
 * Minimal WebSocket client using Node.js built-in APIs (no external deps).
 * Only what we need for CDP: connect, send text frames, receive text frames, close.
 */
import { createConnection, Socket } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { URL } from 'node:url';

export class WebSocket {
  private socket: Socket | null = null;
  private url: string;
  private handlers: Array<(msg: string) => void> = [];
  private buffer = Buffer.alloc(0);

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    const parsed = new URL(this.url);
    const host = parsed.hostname;
    const port = parseInt(parsed.port || '80');
    const path = parsed.pathname + parsed.search;

    return new Promise((resolve, reject) => {
      this.socket = createConnection({ host, port }, () => {
        const key = randomBytes(16).toString('base64');
        const request = [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '', '',
        ].join('\r\n');

        this.socket!.write(request);

        const onData = (chunk: Buffer) => {
          this.buffer = Buffer.concat([this.buffer, chunk]);
          const headerEnd = this.buffer.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            const header = this.buffer.subarray(0, headerEnd).toString();
            if (!header.includes('101')) {
              reject(new Error(`WebSocket upgrade failed: ${header.split('\r\n')[0]}`));
              return;
            }
            this.buffer = this.buffer.subarray(headerEnd + 4);
            this.socket!.off('data', onData);
            this.socket!.on('data', (data) => this.onRawData(data));
            // Process any remaining buffer
            if (this.buffer.length > 0) {
              this.processFrames();
            }
            resolve();
          }
        };
        this.socket!.on('data', onData);
      });

      this.socket.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });
  }

  send(data: string): void {
    if (!this.socket) throw new Error('Not connected');
    const payload = Buffer.from(data, 'utf8');
    const frame = this.encodeFrame(payload);
    this.socket.write(frame);
  }

  onMessage(handler: (msg: string) => void): void {
    this.handlers.push(handler);
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
  }

  private onRawData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processFrames();
  }

  private processFrames(): void {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const masked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (masked) offset += 4;
      if (this.buffer.length < offset + payloadLen) return;

      let payload = this.buffer.subarray(offset, offset + payloadLen);
      if (masked) {
        const mask = this.buffer.subarray(offset - 4, offset);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i % 4];
        }
      }

      this.buffer = this.buffer.subarray(offset + payloadLen);

      const opcode = firstByte & 0x0f;
      if (opcode === 0x01) { // text frame
        const msg = payload.toString('utf8');
        for (const handler of this.handlers) {
          handler(msg);
        }
      } else if (opcode === 0x09) { // ping — reply with pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a; // FIN + pong opcode
        pong[1] = 0x00; // no payload
        this.socket?.write(pong);
      } else if (opcode === 0x08) { // close
        this.close();
        return;
      }
      // Ignore pong (0x0a) and binary (0x02)
    }
  }

  private encodeFrame(payload: Buffer): Buffer {
    const mask = randomBytes(4);
    let header: Buffer;

    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81; // FIN + text
      header[1] = 0x80 | payload.length; // masked + length
      mask.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
      mask.copy(header, 10);
    }

    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) {
      masked[i] ^= mask[i % 4];
    }

    return Buffer.concat([header, masked]);
  }
}
