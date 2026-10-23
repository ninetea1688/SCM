# Context engineering for SCM

How Claude Code (and humans) get the right context at the right moment, and how rules are enforced
rather than merely remembered. Rule of thumb: **knowledge → docs/rules, workflows → skills,
judgement → agents, guarantees → hooks, durable learnings → memory.**

## Layers

| Layer | Where | Loaded | Purpose |
| --- | --- | --- | --- |
| Project instructions | `CLAUDE.md` | every session | Map, commands, 8 non-negotiables, workflow, gotchas. Kept short on purpose. |
| Path rules | `.claude/rules/*.md` (`paths:` frontmatter) | when touching matching files | Layer-specific conventions: domain, db, api, adapters, web, tests. |
| Spec | `prd/prd.md` (owner's, read-only) | on demand + injected by hook | Requirements, AC, phases. |
| Decisions | `docs/decisions/ADR-*.md` | on demand + injected by hook | Every PRD amendment and architectural choice, with status. |
| Progress | `docs/STATUS.md` | SessionStart summary | Traceability: requirement → status → evidence test; "Next up". |
| Skills | `.claude/skills/*/SKILL.md` | when invoked (`/name`) or matched | Repeatable workflows. |
| Agents | `.claude/agents/*.md` | when delegated | Independent reviewers/researchers with narrow tools and fresh context. |
| Hooks | `.claude/settings.json` + `.claude/hooks/*.mjs` | automatically by the harness | Guarantees that don't depend on the model remembering. |
| Memory | `~/.claude/projects/<repo>/memory/` | auto, per user | Owner preferences and lessons that aren't in the repo. |

## Hooks (deterministic guarantees)

| Event | Script | Effect |
| --- | --- | --- |
| SessionStart | `session-context.mjs` | Injects current phase, top "Next up" items, uncommitted-change count. |
| UserPromptSubmit | `req-context.mjs` | Prompt mentions `PUB-03`/`NFR-02`/`ADR-0004` → injects the PRD row, its module's AC and STATUS row (or ADR text). Work starts from the spec. |
| PreToolUse Edit/Write | `guard-files.mjs` | PRD → ask; `.env*` / prod storage creds → deny; drizzle meta → deny; committed migrations → deny. |
| PreToolUse Bash | `guard-bash.mjs` | Denies schema `push`, prod volume deletion, force push, `--no-verify`, formatting Markdown/PRD, reading `.env.prod`; asks for live publishing mode and writes into `prd/`. Heredoc bodies are ignored. |
| PostToolUse Edit/Write | `format-file.mjs` | Biome formats the touched TS/JSON/CSS file (never Markdown). |
| Stop | `stop-verify.mjs` | If TS changed since last green: build packages, typecheck affected workspaces, lint changed files. Fails → Claude must keep working. ~7 s, cached by file fingerprint. Tests are not run here — `pnpm verify` is. |

Permissions in `settings.json` pre-approve safe dev commands and deny reading production secrets.
Review or toggle hooks with `/hooks`.

## Skills

| Skill | Use it for |
| --- | --- |
| `/implement-req <ID>` | The default way to build anything: spec → AC tests → code → STATUS → verify. |
| `/new-adapter <platform>` | Instagram/TikTok/YouTube adapters or platform API changes (ADR-0004 contract). |
| `/new-migration <change>` | Schema changes with RLS and expand/contract for destructive changes. |
| `/verify-platform-limits [platform]` | PRD §0 re-verification before each phase; updates `PLATFORM_LIMITS` with sources. |
| `/phase-gate <Pn>` | Go/no-go against PRD §15 exit criteria, with evidence. |
| `/thai-ux` | Thai copy, พ.ศ. dates, status vocabulary, layout and accessibility rules. |

## Agents

| Agent | Tools | When |
| --- | --- | --- |
| `prd-guardian` | read-only + Bash | After a requirement, before a phase gate: does code match AC/ADRs? |
| `security-reviewer` | read-only + Bash | Auth, tenancy, tokens, webhooks, PDPA, prompt-injection (P4). |
| `platform-researcher` | web + read | Official-docs verification of platform facts, with citations. |
| `test-author` | edits tests only | Missing AC evidence, regression tests. |

User-level plugins also active on this machine (`superpowers`, `ux-ui-agent-skills` design gates and
`design-critic`) complement these; the project files above don't depend on them.

## Typical loop

```
"ทำ CONN-05"  → hook injects CONN-05 row + AC + STATUS
/implement-req CONN-05 → tests named after the AC → code → STATUS row updated
Stop hook → typecheck/lint must be green
prd-guardian + security-reviewer on the diff → fix → pnpm verify → commit "feat(conn): CONN-05 …"
```

## Keeping it healthy

- When Claude makes the same mistake twice, add a line to the relevant `.claude/rules/*.md` or a
  guard to a hook — not a longer CLAUDE.md.
- Keep CLAUDE.md under ~120 lines; move detail into rules/skills.
- Every PRD deviation = ADR. Every ✅ in STATUS = a named test.
