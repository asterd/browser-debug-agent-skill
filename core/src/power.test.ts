import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const powerDir = join(repoRoot, 'power');

const readJson = async (p: string) => JSON.parse(await readFile(p, 'utf8'));
const exists = async (p: string) => access(p).then(() => true, () => false);

/**
 * Structural checks against the Agent Plugins 1.0.0 shape. Deliberately offline:
 * CI must not depend on agent-plugins.org being reachable.
 */
describe('kiro power', () => {
  test('plugin.json has the required fields and no stray ones', async () => {
    const m = await readJson(join(powerDir, 'plugin.json'));

    assert.equal(m.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    assert.ok(m.name, 'name is required');

    // additionalProperties: false in the published schema
    const allowed = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions']);
    const extra = Object.keys(m).filter(k => !allowed.has(k));
    assert.deepEqual(extra, [], `fields not in the schema: ${extra.join(', ')}`);

    assert.match(m.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    assert.ok(m.name.length <= 64);
    assert.match(m.version, /^\d+\.\d+\.\d+/, 'version must be semver');
    assert.equal(typeof m.author, 'object', 'author must be an object');
    assert.ok(m.author.name, 'author.name is mandatory');
    assert.equal(typeof m.repository, 'string', 'repository must be a string');
  });

  test('activation keywords cover how developers actually phrase browser bugs', async () => {
    const { keywords } = await readJson(join(powerDir, 'plugin.json'));
    assert.ok(Array.isArray(keywords) && keywords.length >= 10, 'need a real keyword set');
    assert.ok(keywords.every((k: unknown) => typeof k === 'string'));

    // A power that only triggers on its own product name never activates.
    for (const phrase of ['console error', 'network request', 'responsive', 'screenshot']) {
      assert.ok(keywords.includes(phrase), `missing activation keyword: ${phrase}`);
    }
  });

  test('mcp.json declares a valid stdio server', async () => {
    const m = await readJson(join(powerDir, 'mcp.json'));
    assert.equal(m.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');

    const servers = Object.entries(m.mcpServers) as [string, Record<string, unknown>][];
    assert.equal(servers.length, 1);

    const [, cfg] = servers[0];
    assert.equal(cfg.type, 'stdio');
    assert.ok(cfg.command, 'command is required');
    // additionalProperties: false — only these keys are legal for stdio
    const allowed = new Set(['type', 'command', 'args', 'env', 'cwd']);
    const extra = Object.keys(cfg).filter(k => !allowed.has(k));
    assert.deepEqual(extra, [], `illegal stdio keys: ${extra.join(', ')}`);
  });

  test('the bundled skill is a faithful copy of the canonical one', async () => {
    const powerSkill = join(powerDir, 'skills', 'browser-debug-agent');
    assert.ok(await exists(join(powerSkill, 'SKILL.md')), 'power skill missing — run npm run build');

    const [canonical, bundled] = await Promise.all([
      readFile(join(repoRoot, 'SKILL.md'), 'utf8'),
      readFile(join(powerSkill, 'SKILL.md'), 'utf8'),
    ]);
    assert.equal(bundled, canonical, 'power skill drifted from the repo-root SKILL.md');

    const [refs, powerRefs] = await Promise.all([
      readdir(join(repoRoot, 'references')),
      readdir(join(powerSkill, 'references')),
    ]);
    assert.deepEqual(powerRefs.sort(), refs.sort(), 'reference files differ');
  });

  test('power version tracks the npm package version', async () => {
    const [plugin, pkg] = await Promise.all([
      readJson(join(powerDir, 'plugin.json')),
      readJson(join(repoRoot, 'core', 'package.json')),
    ]);
    assert.equal(plugin.version, pkg.version, 'bump power/plugin.json and core/package.json together');
  });
});
