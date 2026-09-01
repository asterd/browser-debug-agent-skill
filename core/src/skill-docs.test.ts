import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const skillDir = join(packageRoot, 'skill');

async function liveToolNames(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(here, 'mcp-server.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 20_000);
    child.stdout.on('data', c => { out += c.toString(); });
    child.on('exit', () => {
      clearTimeout(timer);
      const line = out.split('\n').find(Boolean);
      if (!line) return reject(new Error('no response'));
      resolve(JSON.parse(line).result.tools.map((t: { name: string }) => t.name));
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    child.stdin.end();
  });
}

async function skillMarkdown(): Promise<string> {
  let text = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
  const refs = join(skillDir, 'references');
  for (const f of await readdir(refs)) {
    text += '\n' + await readFile(join(refs, f), 'utf8');
  }
  return text;
}

describe('skill docs match the tools', () => {
  test('docs never mention a tool the server does not expose', async () => {
    const [tools, docs] = await Promise.all([liveToolNames(), skillMarkdown()]);
    const mentioned = new Set(docs.match(/browser_[a-z_]+/g) ?? []);
    const phantom = [...mentioned].filter(m => !tools.includes(m));
    assert.deepEqual(phantom, [], `docs reference tools that do not exist: ${phantom.join(', ')}`);
  });

  test('every exposed tool is documented', async () => {
    const [tools, docs] = await Promise.all([liveToolNames(), skillMarkdown()]);
    const undocumented = tools.filter(t => !docs.includes(t));
    assert.deepEqual(undocumented, [], `tools missing from the skill docs: ${undocumented.join(', ')}`);
  });

  test('the READMEs list exactly the tools that exist', async () => {
    // README drift is how "10 tools" survived a 12-tool server. Catch it here.
    const tools = await liveToolNames();
    for (const rel of ['README.md', join('core', 'README.md')]) {
      const text = await readFile(join(packageRoot, '..', rel), 'utf8');
      const mentioned = new Set(text.match(/browser_[a-z_]+/g) ?? []);
      if (mentioned.size === 0) continue; // that README does not enumerate tools

      const phantom = [...mentioned].filter(m => !tools.includes(m));
      assert.deepEqual(phantom, [], `${rel} lists tools that do not exist: ${phantom.join(', ')}`);

      const missing = tools.filter(t => !mentioned.has(t));
      assert.deepEqual(missing, [], `${rel} is missing tools: ${missing.join(', ')}`);
    }
  });

  test('the tool surface stays small enough for host tool budgets', async () => {
    // Cursor and others cap total tools across all MCP servers (~40).
    // One server taking half of that budget is antisocial.
    const tools = await liveToolNames();
    assert.ok(tools.length <= 14, `tool count grew to ${tools.length}; keep the surface tight`);
  });
});
