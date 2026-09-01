/**
 * Copy SKILL.md and references into skill/ for npm packaging.
 * Cross-platform (replaces build-bundle.sh).
 */
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const skillDir = join(__dirname, 'skill');

// Clean
rmSync(skillDir, { recursive: true, force: true });
mkdirSync(skillDir, { recursive: true });

// Copy from repo root
if (existsSync(join(repoRoot, 'SKILL.md'))) {
  cpSync(join(repoRoot, 'SKILL.md'), join(skillDir, 'SKILL.md'));
  if (existsSync(join(repoRoot, 'references'))) {
    cpSync(join(repoRoot, 'references'), join(skillDir, 'references'), { recursive: true });
  }
  console.log('Bundled skill files into core/skill/');

  // The Kiro Power ships the same skill. Generate it from the same source so
  // the two can never drift apart.
  const powerSkill = join(repoRoot, 'power', 'skills', 'browser-debug-agent');
  if (existsSync(join(repoRoot, 'power'))) {
    rmSync(powerSkill, { recursive: true, force: true });
    mkdirSync(powerSkill, { recursive: true });
    cpSync(join(repoRoot, 'SKILL.md'), join(powerSkill, 'SKILL.md'));
    if (existsSync(join(repoRoot, 'references'))) {
      cpSync(join(repoRoot, 'references'), join(powerSkill, 'references'), { recursive: true });
    }
    console.log('Bundled skill files into power/skills/browser-debug-agent/');
  }
} else if (existsSync(join(__dirname, 'SKILL.md'))) {
  cpSync(join(__dirname, 'SKILL.md'), join(skillDir, 'SKILL.md'));
  console.log('Bundled skill files into core/skill/ (from local)');
} else {
  console.warn('warning: SKILL.md not found — skill files won\'t be bundled');
}
