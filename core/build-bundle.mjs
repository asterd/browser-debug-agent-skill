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
} else if (existsSync(join(__dirname, 'SKILL.md'))) {
  cpSync(join(__dirname, 'SKILL.md'), join(skillDir, 'SKILL.md'));
  console.log('Bundled skill files into core/skill/ (from local)');
} else {
  console.warn('warning: SKILL.md not found — skill files won\'t be bundled');
}
