# Incremental Review: WI-124 — Add journal instruction to unfixable Andon path

## Verdict: Fail

The journal instruction was added to the unfixable startup-failure path in both files, but the edit to `skills/execute/SKILL.md` left a dangling paragraph that now reads as a continuation of the startup-failure block, creating an ambiguous and contradictory instruction.

## Critical Findings

None.

## Significant Findings

### S1: Dangling general-Critical-Findings paragraph bleeds into startup-failure block
- **File**: `/Users/dan/code/ideate/skills/execute/SKILL.md:405`
- **Issue**: The sentence "If the finding is fixable within the work item's scope without changing the plan: fix it, note in the journal as significant rework." was the opening sentence of the general Critical Findings guidance in the original file. After WI-124 inserted the numbered list ending at step 3 (line 403), that sentence now immediately follows the startup-failure block with no visual separator or heading. A reader encounters: numbered steps 1–3 for startup failures, then this sentence, then the scope-changing paragraph. The sentence applies to *general* critical findings, not to startup failures, but there is no blank-line-plus-heading boundary to signal the switch. An agent reading this section could interpret the sentence as a fourth rule for startup failures — contradicting step 3 (which says to route to Andon if unfixable) by suggesting the fixable sub-case is handled here again.
- **Impact**: Ambiguous instruction creates unpredictable agent behavior when handling startup failures that appear fixable. The agent could either re-apply a fix it already attempted (step 2) or misread step 3's unfixable path as also allowing a fix attempt.
- **Suggested fix**: Add a blank line and a bold label or sub-heading before line 405 to mark it as the general case, separate from the startup-failure exception. For example:

```
3. If the root cause cannot be fixed …: append to the journal — `Diagnosis: …`. Then route to the Andon cord (Phase 9).

**General critical findings (non-startup-failure)**:

If the finding is fixable within the work item's scope without changing the plan: fix it, note in the journal as significant rework.

If the finding is **scope-changing** …
```

## Minor Findings

None.

## Unmet Acceptance Criteria

- [ ] AC4: No other sections in either file are modified — Partially unmet. The sentence at `skills/execute/SKILL.md:405` predates WI-124, but WI-124's edit changed the surrounding structure so that sentence now produces a new readability defect. The letter of AC4 is satisfied (the sentence itself was not touched), but the spirit — that the file is left in a coherent state — is not, because the edit created an ambiguous paragraph boundary that did not exist before.
