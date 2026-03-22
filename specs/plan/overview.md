# Change Plan — Cycle 012 (Inline Prompt Smoke Test Consistency)

**Triggered by**: Cycle 011 review significant finding S1/OQ-8 (inline code-reviewer prompts not updated to match smoke test generalization) and minor finding M2/OQ-9 (brrr finding-handling label missing exclusion qualifier).

---

## What is changing

One work item (WI-129) makes three targeted line edits across two files:

1. `skills/execute/SKILL.md:325` — Replace "If the project cannot build or start" with "If the smoke test fails" in the inline prompt passed to the code-reviewer at spawn time.
2. `skills/brrr/phases/execute.md:113` — Same replacement in the equivalent inline prompt.
3. `skills/brrr/phases/execute.md:160` — Add "(non-startup-failure, non-infrastructure-failure)" exclusion qualifier to the "Critical findings fixable within scope" label.

## What is not changing

- `agents/code-reviewer.md` — already updated in Cycle 011 (WI-126)
- `specs/domains/workflow/policies.md` P-23 — wording already corrected by domain curator
- All other skill and agent files

## Why

WI-126 (Cycle 011) generalized the smoke test concept in `agents/code-reviewer.md` but its acceptance criterion AC-7 ("no other sections modified") explicitly excluded the inline prompt fragments. This was the correct scope constraint at the time, but it created a residual inconsistency: the inline prompts now contradict the agent's own instruction.

The brrr label inconsistency (M2/OQ-9) was introduced when WI-128 added the infra-failure exception to execute/SKILL.md (with the exclusion qualifier) but the equivalent brrr bullet had no qualifier added. This was caught by the capstone review.

## Expected impact

After WI-129, the three locations will be consistent with each other and with the broader smoke test generalization intent. No behavioral change for server/app projects (for which "cannot build or start" and "smoke test fails" are equivalent). Behavioral correction for library, CLI, e2e, and documentation-only projects: code-reviewers spawned during execute or brrr will now correctly identify smoke test failures as Critical findings regardless of project type.

## References

- OQ-8/Q-33: inline prompt inconsistency (workflow/questions.md)
- OQ-9/Q-34: brrr label qualifier (workflow/questions.md)
- D-44: smoke test generalization decision (workflow/decisions.md)
