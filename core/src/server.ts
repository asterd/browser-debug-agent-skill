import { spawn, ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { platform } from 'node:os';
import { execSync } from 'node:child_process';
import type { ServerInfo } from './types.js';

interface StartOpts {
  command: string;
  args?: string[];
  cwd?: string;
  port?: number;
  readinessUrl?: string;
  readinessTimeout?: number;
}

export class ServerManager {
  private ownedProcesses = new Map<number, ChildProcess>();

  /**
   * Auto-detect the dev server start command from package.json scripts.
   */
  async discover(cwd: string = process.cwd()): Promise<{ command: string; manager: string } | null> {
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
      const scripts = pkg.scripts || {};
      // Priority: dev > start > serve
      for (const name of ['dev', 'start', 'serve']) {
        if (scripts[name]) {
          const manager = await this.detectManager(cwd);
          return { command: `${manager} run ${name}`, manager };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Attach to an already-running server at the given URL.
   */
  async attach(url: string, timeout = 5000): Promise<ServerInfo> {
    const reachable = await this.probe(url, timeout);
    if (!reachable) throw new Error(`Server not reachable at ${url}`);
    return { url, owned: false };
  }

  /**
   * Start a dev server and wait for readiness.
   */
  async start(opts: StartOpts): Promise<ServerInfo> {
    const { command, args = [], cwd = process.cwd(), readinessTimeout = 15000 } = opts;
    const port = opts.port || await this.findFreePort();
    const readinessUrl = opts.readinessUrl || `http://127.0.0.1:${port}`;

    const child = spawn(command, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
      detached: false,
    });

    if (!child.pid) throw new Error(`Failed to start: ${command}`);
    this.ownedProcesses.set(child.pid, child);

    await this.waitReady(readinessUrl, readinessTimeout);

    return { url: readinessUrl, pid: child.pid, owned: true, command };
  }

  /**
   * Stop only owned server processes.
   */
  stop(pid: number): boolean {
    const proc = this.ownedProcesses.get(pid);
    if (!proc) return false; // Not owned — refuse to kill.
    try {
      if (platform() === 'win32') {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        proc.kill('SIGTERM');
      }
    } catch { /* already dead */ }
    this.ownedProcesses.delete(pid);
    return true;
  }

  stopAll(): void {
    for (const [pid] of this.ownedProcesses) {
      this.stop(pid);
    }
  }

  private async probe(url: string, timeout: number): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(url, { signal: controller.signal, method: 'HEAD' });
      return resp.ok || resp.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async waitReady(url: string, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.probe(url, 2000)) return;
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`Server did not become ready at ${url} within ${timeout}ms`);
  }

  private async findFreePort(): Promise<number> {
    const { createServer } = await import('node:net');
    return new Promise((resolve, reject) => {
      const srv = createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          const port = addr.port;
          srv.close(() => resolve(port));
        } else {
          reject(new Error('Could not determine port'));
        }
      });
    });
  }

  private async detectManager(cwd: string): Promise<string> {
    const { access } = await import('node:fs/promises');
    const checks: [string, string][] = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm'],
    ];
    for (const [file, mgr] of checks) {
      try {
        await access(join(cwd, file));
        return mgr;
      } catch { /* next */ }
    }
    return 'npm';
  }
}
