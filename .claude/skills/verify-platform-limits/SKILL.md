---
name: verify-platform-limits
description: Re-verify social platform API limits, scopes and deprecations against official docs before a phase starts or when publishing errors appear (PRD §0, OPS-07). Updates PLATFORM_LIMITS and docs/platform-notes.md with sources.
argument-hint: [platform|all]
---

# Verify platform facts: $ARGUMENTS (default: all)

PRD §0 says every API limit must be re-checked before each phase because they change often.

1. Collect current values: `PLATFORM_LIMITS`, `DAILY_PUBLISH_LIMITS` (packages/domain),
   `META_GRAPH_VERSION` default (apps/api/src/config.ts), scopes in PRD §9.3.
2. Dispatch the `platform-researcher` agent (one per platform if checking several) with that list.
   It must return: value, official URL, date checked, and "changed?/deprecated?".
3. For each confirmed change: update the constant (`source`, `verifiedAt` = today), adjust tests,
   and if behaviour changes (e.g. a metric or endpoint deprecated) add an ADR or STATUS item.
4. Append a dated section to `docs/platform-notes.md` (create if missing): table of fact → value →
   source → status. Unverifiable claims are marked "unverified", never guessed.
5. `pnpm verify`.
