## Architecture Deviations

None.

## Unmet Acceptance Criteria

None.

## Principle Violations

None.

## Principle Adherence Evidence

- Principle 1 — Spec Sufficiency: All four WI specs supply exact before/after text, line numbers, and quoted template strings sufficient for two independent runs to produce functionally identical output. Evidence: `/Users/dan/code/ideate/specs/plan/notes/127.md:20-29` (exact journal template with placeholder format).
- Principle 2 — Minimal Inference at Execution: WI-128's infra-failure regression-determination algorithm is fully specified (check changed files for infra-adjacent paths; treat uncertain as regression, attempt diagnosis, then Andon if causation cannot be established). No executor judgment required. Evidence: `/Users/dan/code/ideate/skills/execute/SKILL.md:406`.
- Principle 3 — Guiding Principles Over Implementation Details: WI-126 resolves Q-27 (undefined smoke test for non-server projects) by deriving a heuristic from first principles — "what would a reasonable person be expected to do to demo the work they just did?" — rather than deferring to user input. Evidence: `/Users/dan/code/ideate/specs/plan/notes/126.md:8` and `/Users/dan/code/ideate/agents/code-reviewer.md:86`.
- Principle 5 — Andon Cord Interaction Model: WI-128 adds explicit journal note templates for both regression and non-regression infra failure paths before Andon routing, ensuring no silent failure discard. Evidence: `/Users/dan/code/ideate/skills/execute/SKILL.md:407-408`, `/Users/dan/code/ideate/skills/brrr/phases/execute.md:159`.
- Principle 6 — Durable Knowledge Capture: P-23 added to `specs/domains/workflow/policies.md` with full derivation chain (Q-26, cycle 011 refinement interview), Established field, and Status field. Evidence: `/Users/dan/code/ideate/specs/domains/workflow/policies.md:58-62`.

## Undocumented Additions

### U1: Inline code-reviewer prompts retain pre-generalization "cannot build or start" language

- **Location**: `/Users/dan/code/ideate/skills/execute/SKILL.md:325` and `/Users/dan/code/ideate/skills/brrr/phases/execute.md:113`
- **Description**: Both skill files include an inline prompt fragment passed to the code-reviewer agent at spawn time. This fragment reads: "If the project cannot build or start, report a Critical finding titled 'Startup failure after [work item name]'." This wording predates the WI-126 smoke test generalization. The agent-level instruction in `agents/code-reviewer.md` was updated to the generalized heuristic, but these inline overrides were intentionally excluded from WI-126's scope by AC-7 (no other sections modified) and were not changed.
- **Risk**: A code-reviewer spawned via `execute` or `brrr` receives both the generalized agent instruction (from `agents/code-reviewer.md`) and the narrower inline override ("cannot build or start"). For library projects, CLI tools, and documentation-only work items, the inline override may cause the reviewer to apply startup-failure framing even when the appropriate smoke test is a build check or a test suite run.

## Naming/Pattern Inconsistencies

None.
