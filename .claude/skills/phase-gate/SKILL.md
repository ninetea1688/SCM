---
name: phase-gate
description: Check whether a phase (P0–P5) meets its PRD §15 exit criteria and produce a go/no-go report with evidence. Use before declaring a phase done or planning the next one.
argument-hint: <P1|P2|…>
---

# Phase gate: $ARGUMENTS

1. Read PRD §15 exit criteria for $ARGUMENTS and every requirement tagged with that phase
   (`grep -nE "\| (M|S|C) \| $ARGUMENTS" prd/prd.md`), plus ADRs that moved items in/out.
2. Cross-check `docs/STATUS.md`. For each Must: status, evidence test, and run
   `pnpm --filter @scm/api test -- -t "<evidence>"` (or `pnpm verify` for all) to prove it now.
3. Check the non-functional bits for the phase: NFRs, SEC/PDPA/PLAT items, runbooks, CI green,
   staging deploy, backups.
4. Ask `prd-guardian` for an independent pass over gaps.
5. Report: ✅ met / ❌ not met (with reason) per criterion, blockers needing the owner
   (app reviews, audits, decisions in PRD §17), and a recommended order for the remaining work.
   Update the header and "Next up" in `docs/STATUS.md`.
