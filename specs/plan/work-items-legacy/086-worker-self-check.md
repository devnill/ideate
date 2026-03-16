# 086: Worker Self-Check Before Handoff

## Objective
Add a mandatory acceptance criteria verification step to worker agents so they walk each criterion and report satisfaction status before handing off to the incremental code-reviewer, catching failures at the source rather than in review.

## Acceptance Criteria
- [ ] `skills/execute/SKILL.md` Phase 6 worker prompt includes a self-check instruction block
- [ ] The self-check instruction tells workers to evaluate each acceptance criterion from the work item spec after completing implementation
- [ ] Workers report each criterion as `satisfied: true` (verifiable from code/output), `satisfied: false` (criterion violated — worker must attempt to fix before handoff), or `satisfied: null` (cannot verify without test execution or external validation)
- [ ] Workers do not report completion until all criteria are `true` or `null` — any `false` triggers a fix attempt first
- [ ] The worker's completion report includes the self-check results: a list of criteria with their satisfaction status
- [ ] The incremental code-reviewer receives the self-check results as part of its input, so it can focus on criteria the worker couldn't verify (`null`) and cross-check the worker's `true` claims
- [ ] `skills/brrr/SKILL.md` Phase 6a worker prompt includes the same self-check instruction (or references the same pattern after 081 phase factoring)
- [ ] The self-check instruction block is ≤200 words to stay within prompt size budgets
- [ ] No change to the code-reviewer agent definition — it still performs its full review checklist; the self-check is additive context, not a replacement

## File Scope
- `skills/execute/SKILL.md` (modify)
- `skills/brrr/SKILL.md` (modify)

## Dependencies
- Depends on: none
- Blocks: none

## Implementation Notes

### Self-check instruction block (~150 words)

Add to worker prompt in Phase 6 ("Context for Every Worker"):

```
After implementation, walk every acceptance criterion:
- satisfied: verifiable from code you wrote
- unsatisfied: fix first, then re-check
- unverifiable: cannot verify without tests/external validation

Report with completion:
## Self-Check
- [x] {criterion} — satisfied
- [ ] {criterion} — unverifiable: {reason}

Do not report completion with unsatisfied criteria.
```

### Code-reviewer integration

Pass self-check results to the incremental code-reviewer prompt. Instruct: "Spot-check at least 2 'satisfied' claims. Focus investigation on 'unverifiable' criteria."

## Complexity
Low
