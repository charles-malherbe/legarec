// Avant de rendre la main : lance `pnpm verifier` (types + lint + tests).
// En cas d'échec, Claude Code reçoit le rapport et continue pour corriger (une seule fois, pour éviter une boucle).
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* entrée vide */ }
if (input.stop_hook_active) process.exit(0);

const pkgPath = join(root, 'package.json');
if (!existsSync(pkgPath)) process.exit(0);
let pkg = {};
try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { process.exit(0); }
if (!pkg.scripts || !pkg.scripts.verifier) process.exit(0);

// Rien n'a changé depuis le dernier commit : inutile de tout relancer.
const diff = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (diff.status === 0 && !diff.stdout.trim()) process.exit(0);

const opts = { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 20 * 1024 * 1024 };
let r = spawnSync('pnpm', ['-s', 'verifier'], opts);
if (r.error) r = spawnSync('npm', ['run', '-s', 'verifier'], opts); // pnpm absent : repli sur npm
if (r.status !== 0) {
  const out = ((r.stdout || '') + (r.stderr || '')).split('\n').slice(-60).join('\n');
  process.stderr.write(`« pnpm verifier » échoue. Corrige avant de terminer :\n${out}\n`);
  process.exit(2);
}
process.exit(0);
