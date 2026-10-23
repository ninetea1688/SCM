// SessionStart: orient a fresh session — current phase, next items, uncommitted work.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { addContext, git, ROOT } from './lib.mjs';

const statusPath = path.join(ROOT, 'docs/STATUS.md');
const lines = existsSync(statusPath) ? readFileSync(statusPath, 'utf8').split('\n') : [];
const phase = lines.find((l) => l.startsWith('**Current phase')) ?? '';
const start = lines.findIndex((l) => l.startsWith('## Next up'));
const next = [];
for (let i = start + 1; start >= 0 && i < lines.length && !lines[i].startsWith('## '); i++) {
  if (/^\d+\./.test(lines[i])) next.push(lines[i]);
}
const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
const branch = git(['branch', '--show-current']).trim() || '(no commits yet)';

addContext(
  'SessionStart',
  [
    `[project hook] SCM ${phase.replace(/\*/g, '')}`,
    `Next up (docs/STATUS.md):\n${next.slice(0, 5).join('\n')}`,
    `git: branch ${branch}, ${dirty} uncommitted path(s).`,
    'Before tests: pnpm dev:infra. Finish with pnpm verify. PRD changes → ADR, not prd/prd.md.',
  ].join('\n'),
);
