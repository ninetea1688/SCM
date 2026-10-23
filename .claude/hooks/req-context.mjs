// UserPromptSubmit: when the prompt names requirement IDs (PUB-03, NFR-02) or ADRs (ADR-0004),
// inject the PRD rows, their module's AC block and STATUS rows, so work starts from the spec.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { addContext, ROOT, readInput } from './lib.mjs';

const MODULES =
  'AUTH|CONN|MEDIA|BRAND|POST|AIC|APPR|CAL|PUB|INBOX|MOD|MON|BOT|KB|ANA|CRISIS|NOTI|CRM|OPS|INT|NFR|SEC|PDPA|PLAT';
const input = await readInput();
const prompt = String(input.prompt ?? '');
const ids = [...new Set(prompt.match(new RegExp(`\\b(${MODULES})-\\d{2}\\b`, 'g')) ?? [])].slice(
  0,
  12,
);
const adrs = [...new Set(prompt.match(/\bADR-\d{4}\b/g) ?? [])].slice(0, 4);
if (ids.length === 0 && adrs.length === 0) process.exit(0);

const prdPath = path.join(ROOT, 'prd/prd.md');
const statusPath = path.join(ROOT, 'docs/STATUS.md');
const prd = existsSync(prdPath) ? readFileSync(prdPath, 'utf8').split('\n') : [];
const status = existsSync(statusPath) ? readFileSync(statusPath, 'utf8').split('\n') : [];
const out = [];

const acFor = (rowIdx) => {
  // The AC block follows the module table: scan forward to "AC:" before the next heading.
  for (let i = rowIdx + 1; i < prd.length && !prd[i].startsWith('#'); i++) {
    if (prd[i].trim() === 'AC:') {
      const block = [];
      for (let j = i + 1; j < prd.length && prd[j].startsWith('- '); j++) block.push(prd[j]);
      return block;
    }
  }
  return [];
};

const seenAc = new Set();
for (const id of ids) {
  const idx = prd.findIndex((l) => l.startsWith(`| ${id} `));
  if (idx === -1) continue;
  out.push(`PRD ${id}: ${prd[idx]}`);
  const ac = acFor(idx);
  const key = ac.join('\n');
  if (ac.length && !seenAc.has(key)) {
    seenAc.add(key);
    out.push(`  AC (module of ${id}):\n  ${ac.join('\n  ')}`);
  }
  const st = status.find((l) => l.startsWith(`| ${id}`));
  if (st) out.push(`  STATUS: ${st}`);
}
const adrDir = path.join(ROOT, 'docs/decisions');
for (const adr of adrs) {
  const num = adr.slice(4);
  const f = existsSync(adrDir) ? readdirSync(adrDir).find((n) => n.startsWith(num)) : undefined;
  if (f) out.push(`${adr} (${f}):\n${readFileSync(path.join(adrDir, f), 'utf8').slice(0, 1800)}`);
}
if (out.length === 0) process.exit(0);
addContext(
  'UserPromptSubmit',
  `[project hook] Spec context for IDs in this prompt (source: prd/prd.md, docs/):\n${out.join('\n').slice(0, 8000)}`,
);
