# Execution Strategy — Token Optimization Cycle

## Mode

Batched parallel — work items have dependency chains between phases but independence within each phase.

## Parallelism

Max 3 concurrent agents per group.

## Worktree

Not required. All changes are to skill prompt files and new directories. Groups contain file scope overlaps that are resolved by internal sequencing (see group notes).

## Review Cadence

Incremental review after each item completes. Capstone review after Group 3 (all quick wins and medium-term items complete) and after Group 5 (architectural items).

## Work Item Groups

### Group 1 — Metrics + Quick Wins (internally sequenced)

Items share file scope on `skills/brrr/SKILL.md`, `skills/execute/SKILL.md`, and `skills/review/SKILL.md`. Must be sequenced as specified below — do NOT run in parallel.

| Item | Title | Files | Complexity |
|------|-------|-------|------------|
| 084 | Token metrics instrumentation | `skills/execute/SKILL.md`, `skills/review/SKILL.md`, `skills/brrr/SKILL.md` | Low |
| 086 | Worker self-check | `skills/execute/SKILL.md`, `skills/brrr/SKILL.md` | Low |
| 076 | brrr review manifest | `skills/brrr/SKILL.md` | Low |
| 077 | Eliminate convergence check agent | `skills/brrr/SKILL.md` | Low |
| 078 | Conditional curator model | `skills/review/SKILL.md` | Medium |

**Note**: 084, 086, 076, and 077 all modify `skills/brrr/SKILL.md`. They must be sequenced within this group despite being conceptually independent. Execute 084's brrr changes first (adds metrics logging — append-only, low risk), then 086 (adds self-check to worker prompt — append-only), then 076 (modifies Phase 6b reviewer prompts), then 077 (modifies Phase 6c convergence check). Similarly, 084 and 086 both modify `skills/execute/SKILL.md` — execute 084 first (metrics), then 086 (self-check). 084 and 078 both modify `skills/review/SKILL.md` — execute 084 first, then 078.

**Revised execution order within Group 1:**
1. 084 (all three files — metrics is append-only)
2. 086 + 078 (parallel — 086 touches execute+brrr, 078 touches review)
3. 076 (after 086 — both touch brrr worker/review sections)
4. 077 (after 076 — both touch brrr Phase 6)

### Group 2 — Migration Tool (after Group 1)

| Item | Title | Files | Complexity |
|------|-------|-------|------------|
| 085 | Migration tool | `scripts/migrate-to-optimized.sh` | Medium |

Depends on Group 1 completing so the migration tool can account for all quick-win changes. New file — no conflicts.

### Group 3 — Medium-Term (after Group 1)

| Item | Title | Files | Complexity |
|------|-------|-------|------------|
| 087 | Dense spec format | `plan/work-items.yaml`, `plan/notes/`, `scripts/validate-specs.sh`, all 4 skill SKILL.md files, `scripts/migrate-to-optimized.sh` | High |
| 079 | Shared context package | `skills/review/SKILL.md`, `skills/brrr/SKILL.md` | Medium |
| 081 | Factor brrr phases | `skills/brrr/SKILL.md`, `skills/brrr/phases/*.md` | Medium |

**Sequencing**: 087 depends on all Group 1 items (076, 077, 078, 084, 086) and 085. It modifies all four skill SKILL.md files and must preserve changes from Group 1. It must run BEFORE 079 and 081 so those items work against the new format. 079 and 081 both modify `skills/brrr/SKILL.md` — execute 079 first (adds Phase 3.6 to review, updates brrr Phase 6b prompts), then 081 (refactors brrr into phase documents).

| Item | Title | Files | Complexity |
|------|-------|-------|------------|
| 080 | Differential review | `skills/brrr/SKILL.md`, `skills/brrr/phases/review.md` | High |

**Sequencing**: 080 depends on 076 (manifest) and 081 (phase factoring). After 081, the review phase logic is in `skills/brrr/phases/review.md`, not in SKILL.md. 080 modifies both: commit tracking in SKILL.md, differential logic in `phases/review.md`.

**Revised execution order within Group 3:**
1. 087 (dense format — all skills + migration tool + validation tool)
2. 079 (review skill + brrr skill — after 087)
3. 081 (brrr refactoring — after 079)
4. 080 (differential review — after 081, modifies `phases/review.md`)

### Group 4 — Architectural: MCP Server (after Group 3)

| Item | Title | Files | Complexity |
|------|-------|-------|------------|
| 082 | MCP artifact server | `mcp/artifact-server/*`, `skills/review/SKILL.md`, `docs/context-package-spec.md` | High |

Mostly new files. Also modifies `skills/review/SKILL.md` (MCP availability check in Phase 3.6) and `docs/context-package-spec.md` (availability check documentation). Depends on 079 (read `docs/context-package-spec.md` for the package format).

### Group 5 — Architectural: RAG (after Group 4)

| Item | Title | Files | Complexity |
|------|-------|-------|------------|
| 083 | RAG-based artifact retrieval | `mcp/artifact-server/*` (modify + new files) | High |

Extends the MCP server from 082.

## Dependency Graph

```
084 ──┬── 086 ──┐
      │         ├── 076 ──┬── 077
      │         │         │
      ├── 078   │         ├── 085
      │         │         │
      └─────────┘         │
                          │
 087 (depends on: 076, 077, 078, 084, 086, 085)
  │
  ├── 079 ── 081 ── 080
  │
  └── 082 ── 083

Legend:
  ── depends on (arrow points from dependent to dependency)
```

## Agent Configuration

- Model for workers: sonnet (skill prompt edits are well-scoped)
- Model for reviewers: sonnet
- Permission mode: acceptEdits
- Max turns per worker:
  - Low complexity items (076, 077, 084, 086): 15
  - Medium complexity items (078, 079, 081, 085): 25
  - High complexity items (080, 082, 083, 087): 40
