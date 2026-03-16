# 079: Shared Context Package for Review Agents

## Objective
Create a pre-built context package that the review orchestrator assembles once and passes to all review agents, replacing the pattern where each agent independently reads the same architecture, principles, constraints, and source code files.

## Acceptance Criteria
- [ ] `skills/review/SKILL.md` includes a new Phase 3.6 ("Build Shared Context Package") that runs after Phase 3.5 (review manifest) and before Phase 4a (spawn reviewers)
- [ ] The context package is a single markdown document containing: architecture summary, guiding principles (full text), constraints (full text), source code index (file tree + key exports/interfaces per file)
- [ ] The context package includes absolute paths to full source documents for agents that need deeper detail: "Full architecture at {path}, full principles at {path}, full constraints at {path}"
- [ ] The context package is passed to all three Phase 4a reviewer prompts as inline context (not a file path to read)
- [ ] The journal-keeper prompt (Phase 4b) receives the package as well
- [ ] Each reviewer prompt is updated to remove instructions to independently read architecture, principles, and constraints — these are in the package
- [ ] Each reviewer prompt retains instructions to read source code files as needed for investigating specific findings
- [ ] The source code index in the package includes: file path, language, approximate size, key exports (function/class/type names) for each source file
- [ ] The package is passed inline in the agent prompt (not as a file path to read)
- [ ] A durable specification of the context package format is written to `docs/context-package-spec.md` (in the ideate plugin directory, not in a user's artifact directory) documenting: sections included, size targets, source code index format, and assembly steps — so downstream consumers (082 MCP server) can replicate the package without reading skill internals
- [ ] `skills/brrr/SKILL.md` Phase 6b is updated to use the same shared context package pattern (depends on 076 being complete first)

## File Scope
- `skills/review/SKILL.md` (modify)
- `skills/brrr/SKILL.md` (modify)
- `docs/context-package-spec.md` (create — durable format spec for downstream consumers, in ideate plugin directory)

## Dependencies
- Depends on: 076
- Blocks: none

## Implementation Notes

### Package Contents

Concatenate into a single markdown document:
- Architecture (full, or component map + interface contracts if >300 lines)
- Guiding principles (full)
- Constraints (full)
- Source code index: `| File | Language | Key Exports |` — ~2-5 lines per source file, built via Glob + Grep for export/function/class patterns
- Full document paths for deeper reads

Target: ~500-800 lines. Pass inline in reviewer prompts, replacing per-agent `Context files to read:` instructions.

## Complexity
Medium
