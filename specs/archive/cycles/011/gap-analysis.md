## Summary

Cycle 011 resolved all four open questions it targeted (Q-3, Q-26, Q-27, Q-31). One implementation gap was introduced by the smoke test generalization (WI-126): inline prompt fragments in two skill files were not updated to match the generalized language. The questions.md artifact is not yet updated to reflect resolutions — expected at this stage, pending the domain curator.

## Resolved Questions Verification

### Q-3: spawn_session ordering in review skill
- **Resolved**: `skills/review/SKILL.md:193` now reads "Use the Agent tool to spawn subagents. If the outpost MCP server is configured, `spawn_session` may be used as an alternative." Agent tool is primary. (`skills/plan/SKILL.md:148` and `skills/execute/SKILL.md:299-301` were already correct before this cycle.)
- **Status**: Closed by WI-125.

### Q-26: Smoke test infrastructure failure handling
- **Resolved**: `skills/execute/SKILL.md:405-409` adds "Exception — Smoke test infrastructure failure" block with regression determination (step 1), regression path (diagnose → surgical fix → re-run → Andon if still fails, step 2), and non-regression path (immediate Andon with journal note, step 3). `skills/brrr/phases/execute.md:159` has the equivalent bullet with matching protocol. `specs/domains/workflow/policies.md` adds P-23 capturing the regression-check rule.
- **Status**: Closed by WI-128.

### Q-27: Smoke test generalization beyond startup command
- **Resolved**: `agents/code-reviewer.md:85-94` replaces the startup-specific smoke test with a context-appropriate heuristic: "what would a reasonable person be expected to do to demo the work they just did?" Lists startup command, CLI --help/--version, library build, e2e test, and config/doc validation as examples. `specs/domains/workflow/policies.md` P-22 updated to reference "context-appropriate smoke test."
- **Status**: Closed by WI-126.

### Q-31: Fixable-path journal template
- **Resolved**: `skills/execute/SKILL.md:402` and `skills/brrr/phases/execute.md:158` both contain the exact quoted template: `` `Rework: Startup failure root cause diagnosed and fixed. {brief description of fix}.` `` This matches the format of the unfixable-path template added in cycle 010 (WI-124).
- **Status**: Closed by WI-127.

## Implementation Gaps

### IG1: Inline code-reviewer prompts not updated to match generalized smoke test
- **Location**: `skills/execute/SKILL.md:325` and `skills/brrr/phases/execute.md:113`
- **Gap**: Both skill files pass an inline prompt to the code-reviewer agent that reads: "If the project cannot build or start, report a Critical finding titled 'Startup failure after [work item name]'." WI-126 generalized the smoke test concept in `agents/code-reviewer.md` but WI-126's AC-7 ("No other sections in any of the four files are modified") explicitly excluded these inline prompt lines from scope. The inline prompt now contradicts the agent's own instruction (which says "If the smoke test fails...").
- **Impact**: Code-reviewers spawned by execute or brrr receive both the generalized agent instruction and the narrower "cannot build or start" inline override. For library, CLI, e2e, and documentation-only work items, the inline override does not match the appropriate smoke test type. The inconsistency creates ambiguity about the condition under which to report a Critical finding.
- **Source**: Code-quality.md S1 (this cycle), spec-adherence.md U1 (this cycle).

## Artifact State Gaps

### AG1: workflow/questions.md not yet updated for Q-3, Q-26, Q-27, Q-31
- **Location**: `specs/domains/workflow/questions.md`
- **Gap**: Q-3 (line 23), Q-26 (line 46), Q-27 (line 53), and Q-31 (line 76) remain marked `Status: open`. The domain curator has not yet run for cycle 011.
- **Impact**: Not a functional gap — the curator is expected to resolve these after the capstone review. Noted for completeness.

## No Additional Files Requiring Update

- `skills/brrr/SKILL.md`: Phase documents (brrr/phases/) handle smoke test protocol; brrr/SKILL.md delegates to those. No direct reference to smoke test language in SKILL.md itself.
- `skills/plan/SKILL.md:148`: Already presents Agent tool as primary; spawn_session as secondary. No update needed.
- `skills/execute/SKILL.md:299-301`: Already presents Agent tool as primary with spawn_session as fallback. No update needed for Q-3.

## Missing Requirements

None beyond IG1 above.

## Integration Gaps

None. All four work items modified orthogonal file sections with no integration surface.
