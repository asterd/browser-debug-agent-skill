import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { EvidenceEvent, Artifact } from './types.js';
import { REDACT_PATTERNS } from './types.js';

export class Evidence {
  private seq = 0;
  private logPath: string;
  private sessionId: string;
  private backend: string;

  constructor(sessionId: string, artifactDir: string, backend: string) {
    this.sessionId = sessionId;
    this.backend = backend;
    this.logPath = join(artifactDir, '..', 'evidence.jsonl');
  }

  async emit(command: string, data?: unknown, opts?: { ok?: boolean; error?: string; artifacts?: Artifact[] }): Promise<EvidenceEvent> {
    this.seq++;
    const event: EvidenceEvent = {
      v: 1,
      session: this.sessionId,
      seq: this.seq,
      ts: new Date().toISOString(),
      command,
      backend: this.backend,
      ok: opts?.ok ?? true,
      artifacts: opts?.artifacts ?? [],
      redactions: [],
    };

    if (opts?.error) {
      event.error = this.redact(opts.error);
    } else if (data !== undefined) {
      event.data = this.redactDeep(data);
    }

    // Track which patterns matched
    const raw = JSON.stringify(data ?? opts?.error ?? '');
    for (const pat of REDACT_PATTERNS) {
      pat.lastIndex = 0;
      if (pat.test(raw)) {
        event.redactions.push(pat.source);
      }
    }

    await mkdir(join(this.logPath, '..'), { recursive: true });
    await appendFile(this.logPath, JSON.stringify(event) + '\n');
    return event;
  }

  async registerArtifact(path: string, mediaType: string): Promise<Artifact> {
    const content = await readFile(path);
    const digest = createHash('sha256').update(content).digest('hex').slice(0, 16);
    return { path, mediaType, digest };
  }

  private redact(text: string): string {
    let result = text;
    for (const pat of REDACT_PATTERNS) {
      result = result.replace(pat, '[REDACTED]');
    }
    return result;
  }

  private redactDeep(obj: unknown): unknown {
    if (typeof obj === 'string') return this.redact(obj);
    if (Array.isArray(obj)) return obj.map(item => this.redactDeep(item));
    if (obj && typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = this.redactDeep(v);
      }
      return out;
    }
    return obj;
  }
}
