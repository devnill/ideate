# 080: Differential Review in brrr Cycles 2+

## Objective
After brrr's first comprehensive review, subsequent cycles only review files changed since the last review. Prior review results for unchanged files carry forward as baseline, reducing redundant source code scanning in later cycles.

## Acceptance Criteria
- [ ] `skills/brrr/SKILL.md` Phase 6b tracks which cycle is running (already available from `cycles_completed`)
- [ ] For cycle 1: comprehensive review runs as currently specified (full project scope) — no change
- [ ] For cycles 2+: before spawning reviewers, a diff step identifies files changed since the start of the current cycle
- [ ] The diff step uses `git diff --name-only` against the commit hash recorded at the start of the cycle (see implementation notes)
- [ ] Reviewer prompts for cycles 2+ include: (a) the changed file list, (b) a reference to the prior cycle's review files as baseline, (c) instruction to focus on changed files and their interface boundaries
- [ ] Interface boundary files (files that import/export from changed files) are always included in the review scope even if they didn't change
- [ ] The review output format remains identical — same file structure, same finding format
- [ ] A full review is forced every 3 cycles (configurable) as a safety net, regardless of diff size
- [ ] If the diff step fails (not a git repo, dirty state), fall back to full review and log the reason
- [ ] The review manifest (from 076, updated by 087 to read from `work-items.yaml`) is still generated for the scoped set of work items relevant to the changed files

## File Scope
- `skills/brrr/SKILL.md` (modify — add commit tracking to execute phase)
- `skills/brrr/phases/review.md` (modify — add differential review logic; this file is created by 081)

## Dependencies
- Depends on: 076, 081, 087 (phase factoring must complete first — review logic is in `phases/review.md` after 081. After 087, work items are in `work-items.yaml` — manifest/scope logic must use the new format)
- Blocks: none

## Implementation Notes

### Commit tracking in brrr-state.md

Record `cycle_{N}_start_commit` (at execute start) and `cycle_{N}_end_commit` (at execute end) via `git rev-parse HEAD`. Diff with `git diff --name-only {start}..HEAD`.

### Interface boundary detection

Grep source files for imports/requires referencing changed files. Add dependents to review scope. Best-effort — the full-review safety net (every 3 cycles) covers gaps.

### Reviewer prompt template (cycles 2+)

Pass: changed file list, boundary file list, paths to prior cycle's review files as baseline. Instruct: "Do not re-examine files outside these lists unless a change in a listed file affects an unlisted file."

### brrr-state.md additions

`last_full_review_cycle: {N}` — tracks when the last full review ran.

## Complexity
High
