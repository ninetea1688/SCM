// Stop: if TypeScript changed since the last green check, build packages + typecheck the affected
// workspaces and lint the changed files. On failure exit 2 so Claude keeps working instead of
// stopping on a broken tree. Tests are not run here (need infra; use `pnpm verify`).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git, ROOT, readInput } from './lib.mjs';

const input = await readInput();
if (input.stop_hook_active) process.exit(0); // already continuing because of us — don't loop

const changed = git(['status', '--porcelain', '--untracked-files=all'])
  .split('\n')
  .map((l) => l.slice(3).trim())
  .filter((p) => /^(apps|packages)\/.+\.(ts|tsx|mts)$/.test(p) && existsSync(path.join(ROOT, p)));
if (changed.length === 0) process.exit(0);

const fingerprint = createHash('sha1')
  .update(changed.map((p) => `${p}:${statSync(path.join(ROOT, p)).mtimeMs}`).join('|'))
  .digest('hex');
const stamp = path.join(ROOT, '.claude/hooks/.last-verify');
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint) process.exit(0);

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};
const failures = [];
const touched = (prefix) => changed.some((p) => p.startsWith(prefix));

if (touched('packages/')) {
  const b = run('pnpm', ['-s', 'build:packages']);
  if (!b.ok) failures.push(`build:packages\n${b.out}`);
}
for (const [prefix, pkg] of [
  ['packages/domain', '@scm/domain'],
  ['packages/db', '@scm/db'],
  ['apps/api', '@scm/api'],
  ['apps/web', '@scm/web'],
]) {
  // API and web depend on packages, so a package change re-checks them too.
  if (touched(prefix) || (touched('packages/') && prefix.startsWith('apps/'))) {
    const t = run('pnpm', ['-s', '--filter', pkg, 'typecheck']);
    if (!t.ok) failures.push(`typecheck ${pkg}\n${t.out}`);
  }
}
const lint = run(path.join(ROOT, 'node_modules/.bin/biome'), [
  'check',
  '--diagnostic-level=error',
  ...changed,
]);
if (!lint.ok) failures.push(`biome\n${lint.out}`);

if (failures.length) {
  process.stderr.write(
    `[stop-verify] The working tree does not typecheck/lint. Fix before finishing:\n\n${failures
      .join('\n\n')
      .slice(0, 6000)}`,
  );
  process.exit(2);
}
writeFileSync(stamp, fingerprint);
process.exit(0);
