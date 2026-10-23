// PreToolUse(Bash): block commands that are destructive or bypass the project's safety rails.
import { preToolDecision, readInput } from './lib.mjs';

const input = await readInput();
// Heredoc bodies are data (docs, file contents), not commands — strip them before matching.
const cmd = String(input.tool_input?.command ?? '').replace(
  /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\2(?=\s|$)/g,
  '<<heredoc',
);
const seg = '[^|;&\\n]*';

const rules = [
  [
    new RegExp(`drizzle-kit${seg}\\bpush\\b`),
    'deny',
    'Use pnpm db:generate + pnpm db:migrate (reviewed SQL, RLS policies). `push` skips both.',
  ],
  [
    new RegExp(`docker${seg}compose${seg}prod${seg}\\bdown\\b${seg}(-v|--volumes)`),
    'deny',
    'This deletes production volumes (database, media). Do it by hand if you really mean it.',
  ],
  [/docker\s+volume\s+(rm|prune)/, 'ask', 'Removing Docker volumes deletes data.'],
  [
    new RegExp(`git${seg}push${seg}(--force\\b|-f\\b|--force-with-lease)`),
    'deny',
    'No force pushes. Ask the user.',
  ],
  [/--no-verify\b/, 'deny', 'Do not bypass git hooks; fix what they report.'],
  [
    new RegExp(`\\brm\\s+-[a-z]*r${seg}migrations`),
    'deny',
    'Migrations are forward-only; never delete them.',
  ],
  [
    new RegExp(`(>>?|\\btee\\b|sed\\s+-i|perl\\s+-[a-z]*i|\\bmv\\b|\\bcp\\b)${seg}\\bprd/`),
    'ask',
    "This writes into prd/ (owner's document). Use an ADR unless the owner asked.",
  ],
  [
    new RegExp(`(biome|prettier)${seg}(--write|format)${seg}(\\.md\\b|\\bprd\\b)`),
    'deny',
    'Formatters must not touch Markdown/PRD (they reflowed the PRD once).',
  ],
  [/PUBLISHER_MODE=live/, 'ask', 'Live mode posts to real social accounts.'],
  [/(cat|less|head|tail|grep)\s[^|;&\n]*\.env\.prod/, 'deny', 'Do not read production secrets.'],
];

for (const [re, decision, reason] of rules) {
  if (re.test(cmd)) preToolDecision(decision, reason);
}
process.exit(0);
