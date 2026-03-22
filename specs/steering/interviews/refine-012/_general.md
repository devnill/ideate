# Refinement Interview — 2026-03-22 (General / Cross-Cutting)

**Trigger**: Cycle 011 review findings. S1 (significant): inline code-reviewer prompts in execute/brrr skill files use pre-generalization "cannot build or start" condition. OQ-9 (minor): brrr finding-handling label missing exclusion qualifier. P-23 wording (M1) already fixed by domain curator.

No interview conducted — all changes are direct specification-consistency corrections with no user judgment required.

**Decisions**:
- S1 addressed: replace "cannot build or start" with "smoke test fails" in both inline prompts (execute/SKILL.md:325 and brrr/phases/execute.md:113)
- OQ-9 addressed: add "(non-startup-failure, non-infrastructure-failure)" qualifier to brrr/phases/execute.md:160

**Guiding principles**: unchanged.
**Architecture**: unchanged.
**Constraints**: unchanged.
