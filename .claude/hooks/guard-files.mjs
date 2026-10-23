// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): protect files whose change needs a human decision.
import { existsSync } from 'node:fs';
import { git, preToolDecision, readInput, rel } from './lib.mjs';

const input = await readInput();
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!file) process.exit(0);
const p = rel(file);

if (p.startsWith('prd/')) {
  preToolDecision(
    'ask',
    "prd/ is the PRD owner's document. Propose changes via a new ADR in docs/decisions and docs/prd-review.md. Approve only if the owner asked for this exact edit.",
  );
}
if (/(^|\/)\.env(\.|$)/.test(p) && !p.endsWith('.env.example')) {
  preToolDecision('deny', `${p} holds secrets. Edit .env.example and tell the user what to set.`);
}
if (p.endsWith('docker/seaweedfs/s3.prod.json')) {
  preToolDecision(
    'deny',
    'Production storage credentials are managed on the server, not by Claude.',
  );
}
if (p.startsWith('packages/db/migrations/meta/')) {
  preToolDecision(
    'deny',
    'Drizzle metadata is generated. Change src/schema.ts and run pnpm db:generate.',
  );
}
if (/^packages\/db\/migrations\/.+\.sql$/.test(p) && existsSync(file)) {
  // Committed migration = possibly applied somewhere. Uncommitted (fresh from generate) may be filled in.
  const tracked = git(['ls-files', '--', p]).trim() !== '';
  if (tracked) {
    preToolDecision(
      'deny',
      `${p} is committed and may already be applied. Migrations are forward-only: create a new one (/new-migration).`,
    );
  }
}
process.exit(0);
