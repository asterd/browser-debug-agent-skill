#!/usr/bin/env node
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, access, cp } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from './session.js';
import { ServerManager } from './server.js';
import { Evidence } from './evidence.js';
import { verify } from './verify.js';
import { PlaywrightAdapter } from './adapters/playwright.js';
import type { VerifyManifest, InteractAction, ConsoleEntry, NetworkEntry } from './types.js';

const execFileP = promisify(execFileCb);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Persistent state file for active session (one session at a time per workdir)
const STATE_FILE = '.browser-debug/active-session.json';

interface ActiveState {
  sessionId: string;
}

// --------------- Helpers ---------------

async function loadState(): Promise<ActiveState | null> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function saveState(state: ActiveState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function clearState(): Promise<void> {
  try {
    const { rm } = await import('node:fs/promises');
    await rm(STATE_FILE, { force: true });
  } catch { /* ok */ }
}

function ok(msg: string) { console.log(`\x1b[32m✔\x1b[0m ${msg}`); }
function fail(msg: string) { console.log(`\x1b[31m✘\x1b[0m ${msg}`); }
function info(msg: string) { console.log(`\x1b[36mℹ\x1b[0m ${msg}`); }
function warn(msg: string) { console.log(`\x1b[33m⚠\x1b[0m ${msg}`); }

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function execSafe(cmd: string, args: string[], opts?: { timeout?: number }): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileP(cmd, args, { timeout: opts?.timeout ?? 15000 });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: '' };
  }
}

// --------------- Commands ---------------

const commands: Record<string, string> = {
  setup: 'Verify environment, install deps, configure skill + MCP for Kiro',
  doctor: 'Check available runtimes and environment health',
  open: 'Open a URL in an isolated browser session',
  snapshot: 'Capture accessibility snapshot of current page',
  interact: 'Perform an interaction (click, fill, press)',
  evaluate: 'Evaluate JS in the page context',
  console: 'Get console entries from current session',
  network: 'Get network entries from current session',
  screenshot: 'Take a screenshot',
  verify: 'Run a verification manifest against a URL',
  stop: 'Stop the current browser session',
  session: 'Manage debug sessions (list, stop, clean)',
  server: 'Discover, start, or attach to a dev server',
};

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === 'help' || cmd === '--help') { printHelp(); return; }

  const handlers: Record<string, () => Promise<void>> = {
    setup: cmdSetup,
    doctor: cmdDoctor,
    'mcp-serve': cmdMcpServe,
    open: cmdOpen,
    snapshot: cmdSnapshot,
    interact: cmdInteract,
    evaluate: cmdEvaluate,
    console: cmdConsole,
    network: cmdNetwork,
    screenshot: cmdScreenshot,
    verify: cmdVerify,
    stop: cmdStop,
    session: cmdSession,
    server: cmdServer,
  };

  const handler = handlers[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}. Run 'bda help' for usage.`);
    process.exit(1);
  }
  await handler();
  // Ensure clean exit — except for mcp-serve which runs forever
  if (cmd !== 'mcp-serve') process.exit(0);
}

function printHelp() {
  console.log('bda — Browser Debug Agent V2\n');
  console.log('Usage: bda <command> [options]\n');
  console.log('Commands:');
  for (const [name, desc] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(12)} ${desc}`);
  }
  console.log('\nQuick start:');
  console.log('  bda setup kiro         # configure for Kiro (auto-detects if .kiro/ exists)');
  console.log('  bda setup claude-code  # configure for Claude Code');
  console.log('  bda setup codex        # configure for Codex');
  console.log('  bda open <url>         # open browser session');
  console.log('  bda snapshot           # see page structure');
  console.log('  bda interact click <selector>');
  console.log('  bda verify <file.json> # deterministic assertions');
  console.log('  bda stop               # close session');
  console.log('\nSupported hosts: kiro, claude-code, codex, cursor, opencode, gemini-cli');
}

// --------------- HOST CONFIGURATION ---------------

interface HostConfig {
  name: string;
  skillDir: (scope: 'project' | 'global') => string;
  mcpConfigPath: (scope: 'project' | 'global') => string;
  instructions: string;
}

const HOME = process.env.HOME || process.env.USERPROFILE || '';

const HOSTS: Record<string, HostConfig> = {
  kiro: {
    name: 'Kiro',
    skillDir: (scope) => scope === 'project'
      ? '.kiro/skills/browser-debug-agent'
      : join(process.env.KIRO_HOME || join(HOME, '.kiro'), 'skills/browser-debug-agent'),
    mcpConfigPath: (scope) => scope === 'project'
      ? '.kiro/settings/mcp.json'
      : join(process.env.KIRO_HOME || join(HOME, '.kiro'), 'settings/mcp.json'),
    instructions: 'Restart Kiro to pick up the new MCP server.',
  },
  'claude-code': {
    name: 'Claude Code',
    skillDir: (scope) => scope === 'project'
      ? '.claude/skills/browser-debug-agent'
      : join(HOME, '.claude/skills/browser-debug-agent'),
    mcpConfigPath: (scope) => scope === 'project'
      ? '.claude/settings/mcp.json'
      : join(HOME, '.claude/settings/mcp.json'),
    instructions: 'Restart Claude Code to pick up the new MCP server.',
  },
  codex: {
    name: 'Codex',
    skillDir: (scope) => scope === 'project'
      ? '.codex/skills/browser-debug-agent'
      : join(HOME, '.codex/skills/browser-debug-agent'),
    mcpConfigPath: (scope) => scope === 'project'
      ? '.codex/settings/mcp.json'
      : join(HOME, '.codex/settings/mcp.json'),
    instructions: 'Restart Codex CLI to pick up the new MCP server.',
  },
  cursor: {
    name: 'Cursor',
    skillDir: (scope) => scope === 'project'
      ? '.cursor/skills/browser-debug-agent'
      : join(HOME, '.cursor/skills/browser-debug-agent'),
    mcpConfigPath: (scope) => scope === 'project'
      ? '.cursor/mcp.json'
      : join(HOME, '.cursor/mcp.json'),
    instructions: 'Restart Cursor to pick up the new MCP server.',
  },
  opencode: {
    name: 'OpenCode',
    skillDir: (scope) => scope === 'project'
      ? '.opencode/skills/browser-debug-agent'
      : join(HOME, '.config/opencode/skills/browser-debug-agent'),
    mcpConfigPath: (scope) => scope === 'project'
      ? '.opencode/mcp.json'
      : join(HOME, '.config/opencode/mcp.json'),
    instructions: 'Restart OpenCode to pick up the new MCP server.',
  },
  'gemini-cli': {
    name: 'Gemini CLI',
    skillDir: (scope) => scope === 'project'
      ? '.gemini/skills/browser-debug-agent'
      : join(HOME, '.gemini/skills/browser-debug-agent'),
    mcpConfigPath: (scope) => scope === 'project'
      ? '.gemini/settings/mcp.json'
      : join(HOME, '.gemini/settings/mcp.json'),
    instructions: 'Restart Gemini CLI to pick up the new MCP server.',
  },
};

function detectHost(): string | null {
  // Sync detection not available in ESM — use detectHostAsync instead
  return null;
}

async function detectHostAsync(): Promise<string | null> {
  const priorities: [string, string][] = [
    ['.kiro', 'kiro'],
    ['.claude', 'claude-code'],
    ['.codex', 'codex'],
    ['.cursor', 'cursor'],
    ['.opencode', 'opencode'],
    ['.gemini', 'gemini-cli'],
  ];
  for (const [dir, host] of priorities) {
    if (await exists(dir)) return host;
  }
  return null;
}

function parseHostArg(): { host: string; scope: 'project' | 'global'; force: boolean } {
  let host: string | null = null;
  let scope: 'project' | 'global' = 'project';
  let force = false;

  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--host' || arg === '--ai') {
      host = process.argv[++i];
    } else if (arg === '--global' || arg === '-g') {
      scope = 'global';
    } else if (arg === '--force' || arg === '-f' || arg === '--update') {
      force = true;
    } else if (!arg.startsWith('-') && !host) {
      host = arg;
    }
  }

  if (host && !HOSTS[host]) {
    const available = Object.keys(HOSTS).join(', ');
    console.error(`Unknown host: ${host}. Available: ${available}`);
    process.exit(1);
  }

  return { host: host || '', scope, force };
}

// --------------- SETUP ---------------

async function cmdSetup() {
  let { host, scope, force } = parseHostArg();

  // If no host specified, try to auto-detect or ask
  if (!host) {
    const detected = await detectHostAsync();
    if (detected) {
      host = detected;
      info(`Auto-detected host: ${HOSTS[host].name}`);
    } else {
      console.log('\n🔧 bda setup — preparing your environment\n');
      console.log('Which AI coding agent are you using?\n');
      const hostList = Object.entries(HOSTS);
      hostList.forEach(([key, cfg], i) => {
        console.log(`  ${i + 1}) ${cfg.name.padEnd(14)} (${key})`);
      });
      console.log('');
      console.log('Usage: bda setup <host>');
      console.log('       bda setup kiro');
      console.log('       bda setup claude-code --global');
      console.log('       bda setup codex');
      console.log('');
      console.log('Tip: if your project already has a .kiro/ or .claude/ dir, setup auto-detects it.');
      process.exit(0);
    }
  }

  const hostConfig = HOSTS[host];
  console.log(`\n🔧 bda setup — configuring for ${hostConfig.name} (${scope})\n`);
  let allGood = true;

  // 1. Node.js version
  const nodeVersion = parseInt(process.version.slice(1));
  if (nodeVersion >= 20) {
    ok(`Node.js ${process.version}`);
  } else {
    fail(`Node.js ${process.version} — need >= 20`);
    allGood = false;
  }

  // 2. Playwright
  const pw = await execSafe('npx', ['playwright', '--version']);
  if (pw.ok) {
    ok(`Playwright ${pw.stdout}`);
  } else {
    warn('Playwright not found — installing...');
    const installResult = await execSafe('npm', ['install', '--save-dev', '@playwright/test@latest'], { timeout: 60000 });
    if (installResult.ok) {
      ok('Playwright installed');
    } else {
      fail('Could not install Playwright');
      allGood = false;
    }
  }

  // 3. Chromium browser for Playwright
  const hasBrowsers = await exists('node_modules/playwright-core/.local-browsers');
  if (!hasBrowsers) {
    info('Installing Chromium for Playwright...');
    const browserInstall = await execSafe('npx', ['playwright', 'install', 'chromium'], { timeout: 120000 });
    if (browserInstall.ok) {
      ok('Chromium installed');
    } else {
      const alt = await execSafe('npx', ['playwright', 'install', '--with-deps', 'chromium'], { timeout: 120000 });
      if (alt.ok) ok('Chromium installed (with deps)');
      else { warn('Could not auto-install Chromium — run: npx playwright install chromium'); }
    }
  } else {
    ok('Chromium already available');
  }

  // 4. Core build
  const coreDistExists = await exists(join(__dirname, 'mcp-server.js'));
  if (coreDistExists) {
    ok('bda core built');
  } else {
    warn('bda core not built — building...');
    const build = await execSafe('npm', ['run', 'build'], { timeout: 30000 });
    if (build.ok) ok('bda core built');
    else { fail('Could not build core'); allGood = false; }
  }

  // 5. Install/update skill files (always overwrite — these come from the package)
  const skillDir = hostConfig.skillDir(scope);
  const skillExists = await exists(join(skillDir, 'SKILL.md'));
  const skillAction = skillExists ? 'Updating' : 'Installing';
  info(`${skillAction} skill in ${skillDir}...`);
  await mkdir(skillDir, { recursive: true });

  // Find SKILL.md source: check multiple locations
  const packageRoot = resolve(__dirname, '..');
  const candidates = [
    join(packageRoot, 'skill'),
    resolve(packageRoot, '..'),
    join(packageRoot, 'dist', '..', 'skill'),
  ];

  let sourceRoot = '';
  for (const candidate of candidates) {
    if (await exists(join(candidate, 'SKILL.md'))) {
      sourceRoot = candidate;
      break;
    }
  }

  if (!sourceRoot) {
    fail('Could not find SKILL.md. The package may be corrupted — try reinstalling.');
    allGood = false;
  } else {
    try {
      await cp(join(sourceRoot, 'SKILL.md'), join(skillDir, 'SKILL.md'));
      if (await exists(join(sourceRoot, 'references'))) {
        // Remove old references to avoid stale files
        const refsDir = join(skillDir, 'references');
        try { const { rm } = await import('node:fs/promises'); await rm(refsDir, { recursive: true, force: true }); } catch {}
        await cp(join(sourceRoot, 'references'), refsDir, { recursive: true });
      }
      ok(`Skill ${skillExists ? 'updated' : 'installed'} in ${skillDir}`);
    } catch (e) {
      fail(`Could not copy skill files: ${e}`);
      allGood = false;
    }
  }

  // 6. MCP config
  const mcpConfigPath = hostConfig.mcpConfigPath(scope);

  // Determine the best MCP command:
  // - If bda is in node_modules/.bin (local install), use npx
  // - If bda is globally installed, use the direct path
  // - Fallback: npx (always works if package is published)
  let mcpEntry: { command: string; args: string[]; disabled: boolean };
  const localBin = join(process.cwd(), 'node_modules', '.bin', 'bda');
  if (await exists(localBin)) {
    // Local install: use node_modules path directly
    mcpEntry = { command: 'node', args: [join(process.cwd(), 'node_modules', 'browser-debug-agent', 'dist', 'mcp-server.js')], disabled: false };
  } else {
    // Global or npx: use npx which resolves globally or downloads
    mcpEntry = { command: 'npx', args: ['browser-debug-agent', 'mcp-serve'], disabled: false };
  }

  const mcpExists = await exists(mcpConfigPath);
  if (mcpExists) {
    try {
      const existing = JSON.parse(await readFile(mcpConfigPath, 'utf8'));
      if (existing.mcpServers?.['browser-debug-agent']) {
        ok(`MCP server configured in ${mcpConfigPath}`);
      } else {
        info(`Adding browser-debug-agent to ${mcpConfigPath}...`);
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers['browser-debug-agent'] = mcpEntry;
        await writeFile(mcpConfigPath, JSON.stringify(existing, null, 2));
        ok('MCP server added');
      }
    } catch {
      warn(`Could not parse ${mcpConfigPath} — creating fresh`);
      await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: { 'browser-debug-agent': mcpEntry } }, null, 2));
      ok('MCP config written');
    }
  } else {
    await mkdir(dirname(mcpConfigPath), { recursive: true });
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: { 'browser-debug-agent': mcpEntry } }, null, 2));
    ok(`MCP config created: ${mcpConfigPath}`);
  }

  // 7. .gitignore for .browser-debug/
  const gitignorePath = '.gitignore';
  if (await exists(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf8');
    if (!content.includes('.browser-debug')) {
      await writeFile(gitignorePath, content.trimEnd() + '\n.browser-debug/\n');
      ok('.browser-debug/ added to .gitignore');
    } else {
      ok('.browser-debug/ already in .gitignore');
    }
  } else {
    await writeFile(gitignorePath, '.browser-debug/\n');
    ok('.gitignore created with .browser-debug/');
  }

  // Summary
  console.log('');
  if (allGood) {
    ok(`All set for ${hostConfig.name}!`);
    console.log('');
    console.log('  Next steps:');
    console.log(`  1. ${hostConfig.instructions}`);
    console.log('  2. Ask your agent to debug your frontend — it now has browser tools');
    console.log('  3. Or use the CLI: bda open http://localhost:3000');
  } else {
    fail('Some checks failed. Fix the issues above and run `bda setup` again.');
    process.exit(1);
  }
}

// --------------- DOCTOR ---------------

async function cmdDoctor() {
  console.log('Browser Debug Agent — Doctor\n');

  const pw = await execSafe('npx', ['playwright', '--version']);
  console.log(`  Playwright:      ${pw.ok ? pw.stdout : 'not found'}`);

  const chromePaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome', 'chromium'];
  let chromeVer = 'not found';
  for (const p of chromePaths) {
    const r = await execSafe(p, ['--version'], { timeout: 5000 });
    if (r.ok) { chromeVer = r.stdout; break; }
  }
  console.log(`  Chrome:          ${chromeVer}`);
  console.log(`  Node.js:         ${process.version}`);

  const sm = new SessionManager();
  const sessions = await sm.list();
  const active = sessions.filter(s => s.status === 'active');
  console.log(`  Active sessions: ${active.length}`);

  // Check all hosts
  console.log('\n  Host status:');
  for (const [key, cfg] of Object.entries(HOSTS)) {
    const skillOk = await exists(join(cfg.skillDir('project'), 'SKILL.md'))
      || await exists(join(cfg.skillDir('global'), 'SKILL.md'));
    const mcpProject = await exists(cfg.mcpConfigPath('project'));
    const mcpGlobal = await exists(cfg.mcpConfigPath('global'));
    let mcpConfigured = false;
    for (const path of [cfg.mcpConfigPath('project'), cfg.mcpConfigPath('global')]) {
      try {
        const content = JSON.parse(await readFile(path, 'utf8'));
        if (content.mcpServers?.['browser-debug-agent']) { mcpConfigured = true; break; }
      } catch { /* not there */ }
    }
    const status = skillOk && mcpConfigured ? '\x1b[32m✔ ready\x1b[0m'
      : skillOk ? '\x1b[33m⚠ skill only (no MCP)\x1b[0m'
      : '\x1b[90m· not configured\x1b[0m';
    console.log(`    ${cfg.name.padEnd(14)} ${status}`);
  }

  const anyReady = await (async () => {
    for (const [, cfg] of Object.entries(HOSTS)) {
      const skillOk = await exists(join(cfg.skillDir('project'), 'SKILL.md'))
        || await exists(join(cfg.skillDir('global'), 'SKILL.md'));
      if (skillOk) return true;
    }
    return false;
  })();

  console.log(`\n  Status: ${pw.ok && anyReady ? 'READY' : 'INCOMPLETE — run bda setup <host>'}`);
}

// --------------- BROWSER COMMANDS (daemon-backed) ---------------

// The browser persists between CLI invocations via a daemon process.
// `bda open` starts the daemon; subsequent commands communicate via Unix socket.

import { startDaemon, sendCommand, stopDaemon, isDaemonRunning } from './daemon.js';

let _sm: SessionManager | null = null;

async function ensureDaemon(sessionId: string): Promise<void> {
  if (!isDaemonRunning(sessionId)) {
    throw new Error('No browser daemon running. Run `bda open <url>` first.');
  }
}

async function cmdOpen() {
  const url = process.argv[3];
  if (!url) { console.error('Usage: bda open <url> [width] [height]'); process.exit(1); }

  const width = parseInt(process.argv[4] || '1280');
  const height = parseInt(process.argv[5] || '720');

  _sm = new SessionManager();

  // Stop any existing session first
  const oldState = await loadState();
  if (oldState) {
    try { await stopDaemon(oldState.sessionId); } catch { /* ok */ }
    await _sm.stop(oldState.sessionId);
  }

  // Create new session
  const session = await _sm.create('playwright', { url, browserOwned: true });
  await saveState({ sessionId: session.id });

  // Start daemon
  info(`Starting browser daemon...`);
  await startDaemon(session.id, process.cwd());

  // Open the URL in the daemon
  await sendCommand(session.id, 'launch', { url, viewport: { width, height }, headless: true });

  const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
  await evidence.emit('open', { url, viewport: { width, height } });

  ok(`Session ${session.id} — browser open at ${url}`);
  info('Use: bda snapshot | bda interact | bda console | bda network | bda stop');
}

async function cmdSnapshot() {
  const state = await loadState();
  if (!state) { fail('No active session. Run `bda open <url>` first.'); process.exit(1); }
  await ensureDaemon(state.sessionId);

  const result = await sendCommand(state.sessionId, 'snapshot') as { tree: string };

  _sm = new SessionManager();
  const session = await _sm.get(state.sessionId);
  if (session) {
    const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
    await evidence.emit('snapshot', { treeLength: result.tree.length });
  }

  console.log(result.tree);
}

async function cmdInteract() {
  const type = process.argv[3] as InteractAction['type'];
  const selector = process.argv[4];
  const value = process.argv[5];

  if (!type || !selector) {
    console.error('Usage: bda interact <click|fill|press|hover|select> <selector> [value]');
    process.exit(1);
  }

  const state = await loadState();
  if (!state) { fail('No active session. Run `bda open <url>` first.'); process.exit(1); }
  await ensureDaemon(state.sessionId);

  const action = { type, selector, value, key: value };
  const result = await sendCommand(state.sessionId, 'interact', action) as { ok: boolean; error?: string };

  _sm = new SessionManager();
  const session = await _sm.get(state.sessionId);
  if (session) {
    const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
    await evidence.emit('interact', { action, result });
  }

  if (result.ok) ok(`${type} on ${selector}`);
  else fail(`${type} on ${selector}: ${result.error}`);
}

async function cmdEvaluate() {
  const expr = process.argv.slice(3).join(' ');
  if (!expr) { console.error('Usage: bda evaluate <expression>'); process.exit(1); }

  const state = await loadState();
  if (!state) { fail('No active session.'); process.exit(1); }
  await ensureDaemon(state.sessionId);

  const result = await sendCommand(state.sessionId, 'evaluate', { expr });

  _sm = new SessionManager();
  const session = await _sm.get(state.sessionId);
  if (session) {
    const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
    await evidence.emit('evaluate', { expression: expr, result });
  }

  console.log(JSON.stringify(result, null, 2));
}

async function cmdConsole() {
  const state = await loadState();
  if (!state) { fail('No active session.'); process.exit(1); }
  await ensureDaemon(state.sessionId);

  const entries = await sendCommand(state.sessionId, 'console') as ConsoleEntry[];

  _sm = new SessionManager();
  const session = await _sm.get(state.sessionId);
  if (session) {
    const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
    await evidence.emit('console', { count: entries.length });
  }

  if (entries.length === 0) { info('No console entries.'); return; }
  for (const e of entries) {
    const icon = e.level === 'error' ? '✘' : e.level === 'warn' ? '⚠' : '·';
    console.log(`  ${icon} [${e.level}] ${e.text}`);
  }
}

async function cmdNetwork() {
  const state = await loadState();
  if (!state) { fail('No active session.'); process.exit(1); }
  await ensureDaemon(state.sessionId);

  const entries = await sendCommand(state.sessionId, 'network') as NetworkEntry[];

  _sm = new SessionManager();
  const session = await _sm.get(state.sessionId);
  if (session) {
    const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
    await evidence.emit('network', { count: entries.length });
  }

  if (entries.length === 0) { info('No network entries.'); return; }
  for (const e of entries) {
    const statusColor = e.status >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(`  ${statusColor}${e.status}\x1b[0m ${e.method} ${e.url}`);
  }
}

async function cmdScreenshot() {
  const state = await loadState();
  if (!state) { fail('No active session.'); process.exit(1); }
  await ensureDaemon(state.sessionId);

  _sm = new SessionManager();
  const session = await _sm.get(state.sessionId);
  const artifactDir = session?.artifactDir || '.browser-debug/screenshots';
  const path = join(artifactDir, `screenshot-${Date.now()}.png`);
  await mkdir(dirname(path), { recursive: true });

  await sendCommand(state.sessionId, 'screenshot', { path });

  if (session) {
    const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
    const registered = await evidence.registerArtifact(path, 'image/png');
    await evidence.emit('screenshot', registered, { artifacts: [registered] });
  }

  ok(`Screenshot saved: ${path}`);
}

async function cmdVerify() {
  const manifestPath = process.argv[3];
  if (!manifestPath) {
    console.error('Usage: bda verify <manifest.json>');
    process.exit(1);
  }

  const raw = await readFile(manifestPath, 'utf8');
  const manifest: VerifyManifest = JSON.parse(raw);

  // For verify, we use the in-process adapter (self-contained lifecycle)
  _sm = new SessionManager();
  const session = await _sm.create('playwright');
  const evidence = new Evidence(session.id, session.artifactDir, 'playwright');
  const adapter = new PlaywrightAdapter();

  try {
    const results = await verify(adapter, manifest);
    let allPass = true;

    console.log(`\nVerification: ${manifest.url}\n`);
    for (const r of results) {
      const icon = r.status === 'pass' ? '\x1b[32m✔\x1b[0m' : r.status === 'fail' ? '\x1b[31m✘\x1b[0m' : '○';
      const label = r.assertion.label || `${r.assertion.type}: ${JSON.stringify(r.assertion.expect)}`;
      console.log(`  ${icon} ${label}`);
      if (r.status === 'fail') {
        allPass = false;
        if (r.error) console.log(`    └─ ${r.error}`);
        if (r.actual !== undefined) console.log(`    └─ actual: ${JSON.stringify(r.actual)}`);
      }
      await evidence.emit('verify_assertion', r);
    }

    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const skipped = results.filter(r => r.status === 'skip').length;
    console.log(`\nResults: ${passed} pass, ${failed} fail, ${skipped} skip`);

    await adapter.close();
    await _sm.stop(session.id);

    if (allPass) { ok('VERIFIED'); }
    else { fail('FAILED'); process.exit(1); }
  } catch (err) {
    await evidence.emit('verify', undefined, { ok: false, error: String(err) });
    await adapter.close().catch(() => {});
    await _sm.stop(session.id);
    fail(`Error: ${err}`);
    process.exit(1);
  }
}

async function cmdStop() {
  const state = await loadState();
  if (!state) { info('No active session.'); return; }

  _sm = new SessionManager();
  try { await stopDaemon(state.sessionId); } catch { /* ok */ }
  await _sm.stop(state.sessionId);
  await clearState();
  ok(`Session ${state.sessionId} stopped.`);
}

async function cmdSession() {
  const sub = process.argv[3] || 'list';
  const sm = new SessionManager();

  switch (sub) {
    case 'list': {
      const sessions = await sm.list();
      if (sessions.length === 0) { info('No sessions.'); return; }
      for (const s of sessions) {
        console.log(`  ${s.id}  ${s.status.padEnd(8)}  ${s.backend}  ${s.url || '(no url)'}`);
      }
      break;
    }
    case 'stop': {
      const id = process.argv[4];
      if (!id) { console.error('Usage: bda session stop <id>'); process.exit(1); }
      await sm.stop(id);
      ok(`Session ${id} stopped.`);
      break;
    }
    case 'clean': {
      const sessions = await sm.list();
      let cleaned = 0;
      for (const s of sessions) {
        if (s.status === 'stopped') { await sm.cleanup(s.id); cleaned++; }
      }
      ok(`Cleaned ${cleaned} stopped sessions.`);
      break;
    }
    default:
      console.error(`Unknown session subcommand: ${sub}`);
      process.exit(1);
  }
}

async function cmdServer() {
  const sub = process.argv[3] || 'discover';
  const mgr = new ServerManager();

  switch (sub) {
    case 'discover': {
      const result = await mgr.discover();
      if (result) ok(`Detected: ${result.command} (via ${result.manager})`);
      else info('No dev server script detected in package.json.');
      break;
    }
    case 'start': {
      const cmd = process.argv[4];
      if (!cmd) {
        const discovered = await mgr.discover();
        if (!discovered) { fail('No server command. Usage: bda server start <command>'); process.exit(1); }
        info(`Starting: ${discovered.command}`);
        const serverInfo = await mgr.start({ command: discovered.command });
        ok(`Server running at ${serverInfo.url} (pid: ${serverInfo.pid})`);
      } else {
        const serverInfo = await mgr.start({ command: cmd });
        ok(`Server running at ${serverInfo.url} (pid: ${serverInfo.pid})`);
      }
      break;
    }
    case 'attach': {
      const url = process.argv[4];
      if (!url) { console.error('Usage: bda server attach <url>'); process.exit(1); }
      try {
        const serverInfo = await mgr.attach(url);
        ok(`Attached to ${serverInfo.url} (not owned — won't be stopped)`);
      } catch (e) {
        fail(String(e));
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown server subcommand: ${sub}. Use: discover, start, attach`);
      process.exit(1);
  }
}

async function cmdMcpServe() {
  // Start the MCP server on stdio (used by the host's mcp.json config)
  const { startServer } = await import('./mcp-server.js');
  startServer();
  // Don't exit — keep running until the host disconnects
  await new Promise(() => {}); // Block forever
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
