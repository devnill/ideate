# 081: Factor brrr Prompt into Phase Documents

## Objective
Split the brrr SKILL.md (~707 lines) into a compact loop controller and separate phase instruction documents, so only the currently active phase's instructions occupy context.

## Acceptance Criteria
- [ ] `skills/brrr/SKILL.md` is reduced to ~150 lines containing: argument parsing, artifact validation, loop control logic, convergence checking, and phase dispatch
- [ ] Phase-specific instructions are extracted to separate files in `skills/brrr/`
- [ ] `skills/brrr/phases/execute.md` contains the execute phase instructions (current Phase 6a content)
- [ ] `skills/brrr/phases/review.md` contains the comprehensive review instructions (current Phase 6b content)
- [ ] `skills/brrr/phases/refine.md` contains the refinement phase instructions (current Phase 6d content)
- [ ] `skills/brrr/phases/reporting.md` contains the activity report and convergence declaration instructions (current Phases 7-9)
- [ ] The loop controller reads the relevant phase document at the start of each phase transition using the Read tool
- [ ] Each phase document is self-contained: it includes all necessary context, entry conditions, exit conditions, and output expectations without referencing other phase documents
- [ ] The Andon cord → proxy-human routing logic is included in `execute.md` (where it's used) rather than in the controller
- [ ] Incremental review logic (per-work-item code-reviewer spawn) is included in `execute.md`
- [ ] The brrr loop writes the same artifact files to the same paths as before factoring (journal.md, brrr-state.md, archive/incremental/*, archive/cycles/*, proxy-human-log.md)
- [ ] The convergence check logic (Conditions A and B) remains in the controller, not in a phase document
- [ ] The "What You Do Not Do" section remains in the main SKILL.md (it applies to all phases)

## File Scope
- `skills/brrr/SKILL.md` (modify — reduce to loop controller)
- `skills/brrr/phases/execute.md` (create)
- `skills/brrr/phases/review.md` (create)
- `skills/brrr/phases/refine.md` (create)
- `skills/brrr/phases/reporting.md` (create)

## Dependencies
- Depends on: 076, 077, 079 (079 adds shared context package to brrr Phase 6b — must be incorporated before 081 extracts phases into separate files)
- Blocks: none

## Implementation Notes

### Directory structure

```
skills/brrr/
├── SKILL.md              # Loop controller (~150 lines)
└── phases/
    ├── execute.md         # Phase 6a logic
    ├── review.md          # Phase 6b logic (includes manifest generation from 076)
    ├── refine.md          # Phase 6d logic
    └── reporting.md       # Phases 7, 8, 9
```

### Controller structure

Phases 1-5 (setup) remain inline — they're small and run once. Phase 6 main loop dispatches to phase documents via Read tool. Convergence check (~20 lines) stays inline. "What You Do Not Do" stays in controller (applies to all phases).

### Phase document template

Each document: Entry Conditions, Instructions (self-contained), Exit Conditions, Artifacts Written. No cross-references between phase documents.

## Complexity
Medium
