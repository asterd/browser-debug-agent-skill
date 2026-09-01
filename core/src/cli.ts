#!/usr/bin/env node
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { readFile, writeFile, mkdir, access, cp } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from './session.js';
import { ServerManager } from './server.js';
import { Evidence } from './evidence.js';
import { verify } from './verify.js';
import { createAdapter } from './adapters/factory.js';
import type { BackendName } from './adapters/factory.js';
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
  open: 'Open a URL (headless+isolated by default; --visible, --profile user)',
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
  update: 'Update bda to the latest version and refresh installed skills',
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
    update: cmdUpdate,
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
  console.log('  bda open <url>         # headless; add --visible to watch it');
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

function parseHostArg(): { host: string; scope: 'project' | 'global' } {
  let host: string | null = null;
  let scope: 'project' | 'global' = 'project';

  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--host' || arg === '--ai') {
      host = process.argv[++i];
    } else if (arg === '--global' || arg === '-g') {
      scope = 'global';
    } else if (arg === '--force' || arg === '-f' || arg === '--update') {
      // Accepted for compatibility: setup always overwrites the skill files.
    } else if (!arg.startsWith('-') && !host) {
      host = arg;
    }
  }

  if (host && !HOSTS[host]) {
    const available = Object.keys(HOSTS).join(', ');
    console.error(`Unknown host: ${host}. Available: ${available}`);
    process.exit(1);
  }

  return { host: host || '', scope };
}

// --------------- SETUP ---------------

async function cmdSetup() {
  let { host, scope } = parseHostArg();

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

  // 2. Chrome
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome', 'google-chrome-stable', 'chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  let chromeFound = false;
  for (const p of chromePaths) {
    const r = await execSafe(p, ['--version'], { timeout: 5000 });
    if (r.ok) { ok(`Chrome: ${r.stdout}`); chromeFound = true; break; }
  }
  if (!chromeFound) {
    fail('Chrome not found. Install Google Chrome: https://google.com/chrome');
    allGood = false;
  }

  // 3. Core build
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

  try {
    await installSkillFiles(skillDir);
    ok(`Skill ${skillExists ? 'updated' : 'installed'} in ${skillDir}`);
  } catch (e) {
    fail(`Could not install skill files: ${e}`);
    allGood = false;
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

/**
 * Copy SKILL.md + references from the package into an install dir.
 * Shared by `setup` and `update` so they can never drift apart.
 */
async function installSkillFiles(skillDir: string): Promise<void> {
  const packageRoot = resolve(__dirname, '..');
  const candidates = [
    join(packageRoot, 'skill'),
    resolve(packageRoot, '..'),
    join(packageRoot, 'dist', '..', 'skill'),
  ];

  let sourceRoot = '';
  for (const candidate of candidates) {
    if (await exists(join(candidate, 'SKILL.md'))) { sourceRoot = candidate; break; }
  }
  if (!sourceRoot) throw new Error('Could not find SKILL.md — the package may be corrupted.');

  await mkdir(skillDir, { recursive: true });
  await cp(join(sourceRoot, 'SKILL.md'), join(skillDir, 'SKILL.md'));

  if (await exists(join(sourceRoot, 'references'))) {
    // Remove old references so a renamed/deleted file cannot linger
    const refsDir = join(skillDir, 'references');
    const { rm } = await import('node:fs/promises');
    await rm(refsDir, { recursive: true, force: true });
    await cp(join(sourceRoot, 'references'), refsDir, { recursive: true });
  }
}

// --------------- DOCTOR ---------------

async function cmdDoctor() {
  console.log('Browser Debug Agent — Doctor\n');

  const chromePaths = platform() === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
    : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       'google-chrome', 'google-chrome-stable', 'chromium'];
  let chromeVer = 'not found';
  if (platform() === 'win32') {
    // On Windows, just check existence — --version hangs
    for (const p of chromePaths) {
      if (await exists(p)) { chromeVer = `found at ${p}`; break; }
    }
  } else {
    for (const p of chromePaths) {
      const r = await execSafe(p, ['--version'], { timeout: 5000 });
      if (r.ok) { chromeVer = r.stdout; break; }
    }
  }
  console.log(`  Chrome:          ${chromeVer}`);
  console.log(`  Node.js:         ${process.version}`);

  const sm = new SessionManager();
  await sm.reconcile(isSessionAlive);
  const sessions = await sm.list();
  const active = sessions.filter(s => s.status === 'active');
  console.log(`  Active sessions: ${active.length}`);
  const stale = sessions.filter(s => s.status !== 'active').length;
  if (stale > 0) console.log(`  Finished sessions: ${stale} (bda session clean)`);

  // Check all hosts
  console.log('\n  Host status:');
  for (const [, cfg] of Object.entries(HOSTS)) {
    const skillOk = await exists(join(cfg.skillDir('project'), 'SKILL.md'))
      || await exists(join(cfg.skillDir('global'), 'SKILL.md'));
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

  console.log(`\n  Status: ${chromeVer !== 'not found' && anyReady ? 'READY' : 'INCOMPLETE — run bda setup <host>'}`);
}

// --------------- BROWSER COMMANDS (daemon-backed) ---------------

// The browser persists between CLI invocations via a daemon process.
// `bda open` starts the daemon; subsequent commands communicate via Unix socket.

import { startDaemon, sendCommand, stopDaemon, isDaemonRunning } from './daemon.js';

let _sm: SessionManager | null = null;

/** A session is only alive while its daemon is still running. */
function isSessionAlive(m: { id: string }): boolean {
  return isDaemonRunning(m.id);
}

async function ensureDaemon(sessionId: string): Promise<void> {
  if (!isDaemonRunning(sessionId)) {
    throw new Error('No browser daemon running. Run `bda open <url>` first.');
  }
}

async function cmdOpen() {
  const url = process.argv[3];
  if (!url) {
    console.error('Usage: bda open <url> [width] [height] [--visible] [--profile isolated|user] [--playwright]');
    process.exit(1);
  }

  // Positional width/height, ignoring flags
  const positional = process.argv.slice(4).filter(a => !a.startsWith('-'));
  const width = parseInt(positional[0] || '1280');
  const height = parseInt(positional[1] || '720');

  const visible = process.argv.includes('--visible') || process.argv.includes('--headed');
  const profileIdx = process.argv.indexOf('--profile');
  const profile = profileIdx !== -1 ? process.argv[profileIdx + 1] : 'isolated';
  if (!['isolated', 'user', 'custom'].includes(profile)) {
    console.error(`Invalid --profile: ${profile}. Use isolated, user, or custom.`);
    process.exit(1);
  }
  if (profile === 'user') {
    warn('Using your real Chrome profile. Quit Chrome first, or it will refuse to start.');
  }

  _sm = new SessionManager();

  // Stop any existing session first
  const oldState = await loadState();
  if (oldState) {
    try { await stopDaemon(oldState.sessionId); } catch { /* ok */ }
    await _sm.stop(oldState.sessionId);
  }

  // Determine backend: --playwright flag or default chrome-cdp
  const usePlaywright = process.argv.includes('--playwright');
  const backend: BackendName = usePlaywright ? 'playwright' : 'chrome-cdp';

  // Create new session
  const session = await _sm.create(backend, { url, browserOwned: true });
  await saveState({ sessionId: session.id });

  // Start daemon with the chosen backend
  info(`Starting browser daemon (${backend})...`);
  await startDaemon(session.id, process.cwd(), backend);

  // Open the URL in the daemon
  await sendCommand(session.id, 'launch', {
    url,
    viewport: { width, height },
    headless: !visible,
    profile,
  });

  const evidence = new Evidence(session.id, session.artifactDir, backend);
  await evidence.emit('open', { url, viewport: { width, height }, backend, mode: visible ? 'visible' : 'headless', profile });

  ok(`Session ${session.id} — browser open at ${url} (${visible ? 'visible' : 'headless'}, ${profile} profile)`);
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
    const evidence = new Evidence(session.id, session.artifactDir, 'chrome-cdp');
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
    const evidence = new Evidence(session.id, session.artifactDir, 'chrome-cdp');
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
    const evidence = new Evidence(session.id, session.artifactDir, 'chrome-cdp');
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
    const evidence = new Evidence(session.id, session.artifactDir, 'chrome-cdp');
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
    const evidence = new Evidence(session.id, session.artifactDir, 'chrome-cdp');
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
    const evidence = new Evidence(session.id, session.artifactDir, 'chrome-cdp');
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
  const backend: BackendName = (process.argv.find(a => a === '--playwright') ? 'playwright' : 'chrome-cdp');
  const session = await _sm.create(backend);
  const evidence = new Evidence(session.id, session.artifactDir, backend);
  const adapter = await createAdapter(backend);

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
    // Give OS time to reap Chrome subprocesses after kill
    await new Promise(r => setTimeout(r, 200));
    await _sm.stop(session.id);

    if (allPass) { ok('VERIFIED'); }
    else { fail('FAILED'); process.exit(1); }
  } catch (err) {
    await evidence.emit('verify', undefined, { ok: false, error: String(err) });
    await adapter.close().catch(() => {});
    await new Promise(r => setTimeout(r, 200));
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
      await sm.reconcile(isSessionAlive);
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
      // Reconcile first, so sessions orphaned by a crash are also reaped.
      await sm.reconcile(isSessionAlive);
      const cleaned = await sm.cleanupFinished();
      ok(`Cleaned ${cleaned} finished sessions.`);
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

// --------------- UPDATE ---------------

async function cmdUpdate() {
  console.log('Updating browser-debug-agent...\n');

  const installed = await execSafe('npm', ['ls', '-g', '--depth=0', '--json', 'browser-debug-agent'], { timeout: 30000 });
  const isGlobal = installed.ok && installed.stdout.includes('browser-debug-agent');

  if (isGlobal) {
    info('Updating global install (npm install -g browser-debug-agent@latest)...');
    const r = await execSafe('npm', ['install', '-g', 'browser-debug-agent@latest'], { timeout: 180000 });
    if (!r.ok) { fail('npm install failed. Run it manually: npm install -g browser-debug-agent@latest'); process.exit(1); }
    ok('Package updated');
  } else {
    info('Not a global install — updating in this project (npm install browser-debug-agent@latest)...');
    const r = await execSafe('npm', ['install', 'browser-debug-agent@latest'], { timeout: 180000 });
    if (!r.ok) { fail('npm install failed. Run it manually: npm install browser-debug-agent@latest'); process.exit(1); }
    ok('Package updated');
  }

  // Refresh skill files wherever they are already installed, so the docs the
  // agent reads never lag behind the tools it can call.
  let refreshed = 0;
  for (const [, cfg] of Object.entries(HOSTS)) {
    for (const scope of ['project', 'global'] as const) {
      const dir = cfg.skillDir(scope);
      if (await exists(join(dir, 'SKILL.md'))) {
        try {
          await installSkillFiles(dir);
          ok(`Skill refreshed: ${dir}`);
          refreshed++;
        } catch (e) {
          warn(`Could not refresh ${dir}: ${e}`);
        }
      }
    }
  }
  if (refreshed === 0) info('No installed skills found. Run `bda setup <host>` to install one.');

  console.log('');
  ok('Update complete. Restart your AI host to pick up changes.');
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
