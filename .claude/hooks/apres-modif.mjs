// Après chaque modification de fichier : formatage Prettier puis ESLint --fix.
// Ne fait rien tant que le projet n'est pas initialisé (pas de package.json ou outils absents).
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const file = input?.tool_input?.file_path;
if (!file || !existsSync(join(root, 'package.json'))) process.exit(0);
if (/[\\/](node_modules|dist|maquette)[\\/]/.test(file)) process.exit(0);

const bin = (name) => {
  const p = join(root, 'node_modules', '.bin', process.platform === 'win32' ? name + '.cmd' : name);
  return existsSync(p) ? p : null;
};
const ext = extname(file).toLowerCase();
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });

const prettier = bin('prettier');
if (prettier && ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.md', '.html', '.hbs', '.yml', '.yaml'].includes(ext)) {
  run(prettier, ['--write', '--log-level', 'silent', file]);
}

const eslint = bin('eslint');
if (eslint && ['.ts', '.tsx', '.js', '.mjs'].includes(ext)) {
  const r = run(eslint, ['--fix', '--no-warn-ignored', file]);
  if (r.status !== 0) {
    process.stderr.write(`ESLint signale des erreurs dans ${file} :\n${(r.stdout || '') + (r.stderr || '')}\nCorrige-les avant de continuer.\n`);
    process.exit(2);
  }
}
process.exit(0);
