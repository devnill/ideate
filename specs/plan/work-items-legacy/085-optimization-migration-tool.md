# 085: Optimization Migration Tool

## Objective
Create a migration script that updates existing ideate artifact directories to work with the changes introduced by the optimization work items (076-084), handling both the brrr review path changes and the new metrics/phase file structures.

## Acceptance Criteria
- [ ] A script exists at `scripts/migrate-to-optimized.sh` (or `.py`)
- [ ] The script accepts an artifact directory path as argument
- [ ] The script detects the current state of the artifact directory and reports what migrations are needed
- [ ] The script supports `--dry-run` mode that reports what would change without modifying anything
- [ ] The script supports `--verbose` mode that explains each change
- [ ] The following migrations are supported:

### Migration 1: brrr review path normalization
- [ ] If `reviews/incremental/` exists and `archive/incremental/` does not, create a symlink or note the canonical path (brrr uses `reviews/incremental/`, review skill uses `archive/incremental/`)
- [ ] If both exist, report the situation and ask which is canonical

### Migration 2: brrr-state.md schema update
- [ ] If `brrr-state.md` exists, add missing fields for differential review support:
  - `last_full_review_cycle: 0`
  - Any missing `cycle_N_start_commit` / `cycle_N_end_commit` fields (leave empty — they'll be populated on next run)
- [ ] If `brrr-state.md` does not exist, skip (created fresh on next brrr run)

### Migration 3: Metrics file initialization
- [ ] Create `metrics.jsonl` if it doesn't exist (empty file)
- [ ] Add `metrics.jsonl` to `.gitignore` if a `.gitignore` exists in the artifact directory or project root

### Migration 4: Phase document directory
- [ ] If `skills/brrr/phases/` does not exist in the project, report that the brrr phase factoring (081) has not been applied yet — this is informational only, not a migration

### Migration 5: MCP server configuration hint
- [ ] If the artifact MCP server (082) is built, check whether it's configured in `.claude/settings.json` or `.mcp.json`
- [ ] If not configured, print configuration instructions (do not auto-modify Claude Code settings)

### General requirements:
- [ ] The script uses a modular structure: one function per migration, a main loop that iterates over registered migrations, and a pattern for adding new migrations by adding a new function (087 will extend this script with a format migration)
- [ ] The script is idempotent — running it twice produces the same result
- [ ] The script does not delete any files
- [ ] The script does not modify artifact content (work items, reviews, steering docs)
- [ ] The script creates a backup of any files it modifies: `{filename}.pre-migration-backup`
- [ ] The script logs all actions to `{artifact_dir}/migration-log.md` with timestamps
- [ ] The script exits with code 0 on success, 1 on error, 2 on dry-run-would-change

## File Scope
- `scripts/migrate-to-optimized.sh` (create)

## Dependencies
- Depends on: none (can be built first and extended as other items complete)
- Blocks: none

## Implementation Notes

### Review path discrepancy

Review skill uses `archive/incremental/` (line 73), brrr uses `reviews/incremental/` (line 232). Normalize to `archive/incremental/`, symlink for backward compat. Flag for 076 to fix in the brrr skill.

### Structure

One function per migration. Main loop checks need, runs or reports (dry-run). New migrations added as new functions.

## Complexity
Medium
