// PostToolUse(Edit|Write|MultiEdit): format the touched file with Biome. Never blocks.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, readInput, rel } from './lib.mjs';

const input = await readInput();
const file = input.tool_input?.file_path;
if (!file) process.exit(0);
const p = rel(file);
if (
  !/\.(ts|tsx|mts|mjs|js|json|css)$/.test(p) ||
  p.startsWith('prd/') ||
  p.includes('/migrations/meta/')
) {
  process.exit(0);
}
spawnSync(
  path.join(ROOT, 'node_modules/.bin/biome'),
  ['check', '--write', '--no-errors-on-unmatched', p],
  {
    cwd: ROOT,
    stdio: 'ignore',
    timeout: 20_000,
  },
);
process.exit(0);
