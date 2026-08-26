import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionManifest } from './types.js';

const SESSIONS_DIR = '.browser-debug/sessions';

export class SessionManager {
  private baseDir: string;

  constructor(workDir: string = process.cwd()) {
    this.baseDir = join(workDir, SESSIONS_DIR);
  }

  async create(backend: string, opts?: Partial<SessionManifest>): Promise<SessionManifest> {
    const id = randomUUID().slice(0, 8);
    const artifactDir = join(this.baseDir, id, 'artifacts');
    await mkdir(artifactDir, { recursive: true });

    const manifest: SessionManifest = {
      id,
      createdAt: new Date().toISOString(),
      backend,
      serverOwned: false,
      browserOwned: false,
      artifactDir,
      status: 'active',
      ...opts,
    };

    await this.save(manifest);
    return manifest;
  }

  async get(id: string): Promise<SessionManifest | null> {
    try {
      const data = await readFile(this.manifestPath(id), 'utf8');
      return JSON.parse(data) as SessionManifest;
    } catch {
      return null;
    }
  }

  async list(): Promise<SessionManifest[]> {
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      const manifests: SessionManifest[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const m = await this.get(entry.name);
          if (m) manifests.push(m);
        }
      }
      return manifests;
    } catch {
      return [];
    }
  }

  async stop(id: string): Promise<void> {
    const manifest = await this.get(id);
    if (!manifest) return;
    manifest.status = 'stopped';
    await this.save(manifest);
  }

  async update(id: string, patch: Partial<SessionManifest>): Promise<void> {
    const manifest = await this.get(id);
    if (!manifest) return;
    Object.assign(manifest, patch);
    await this.save(manifest);
  }

  async cleanup(id: string): Promise<void> {
    const dir = join(this.baseDir, id);
    await rm(dir, { recursive: true, force: true });
  }

  private async save(manifest: SessionManifest): Promise<void> {
    const dir = join(this.baseDir, manifest.id);
    await mkdir(dir, { recursive: true });
    await writeFile(this.manifestPath(manifest.id), JSON.stringify(manifest, null, 2));
  }

  private manifestPath(id: string): string {
    return join(this.baseDir, id, 'manifest.json');
  }
}
