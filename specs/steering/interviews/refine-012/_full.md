# Refinement Interview — 2026-03-22 (Cycle 012 planning)

**Context**: Cycle 011 review returned Fail — 1 significant finding (S1/OQ-8: inline code-reviewer prompts still use "cannot build or start" condition after smoke test generalization), 1 minor finding still outstanding (M2/OQ-9: brrr finding-handling label missing exclusion qualifier). The P-23 wording issue (M1) was corrected by the domain curator during the Cycle 011 review. Scope is fully determined by review findings — no design decisions required.

---

## No interview conducted

All changes are direct specification-consistency corrections with no design decisions required. Both findings are unambiguous line-edit fixes:

1. **S1/OQ-8** (Significant): `skills/execute/SKILL.md:325` and `skills/brrr/phases/execute.md:113` inline prompts say "If the project cannot build or start" — should match the generalized agent instruction "If the smoke test fails." Fix: replace the condition string in both locations.

2. **M2/OQ-9** (Minor): `skills/brrr/phases/execute.md:160` label "Critical findings fixable within scope" is missing the "(non-startup-failure, non-infrastructure-failure)" exclusion qualifier present in `skills/execute/SKILL.md:410`. Fix: add the qualifier.

## Work Items

**WI-129**: `skills/execute/SKILL.md:325` and `skills/brrr/phases/execute.md:113` — replace "cannot build or start" with "smoke test fails"; `skills/brrr/phases/execute.md:160` — add exclusion qualifier. All three changes bundled into one work item (trivial scope, shared file constraint requires sequential execution).
