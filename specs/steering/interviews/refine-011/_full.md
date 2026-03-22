## Refinement Interview — 2026-03-22 (Cycle 011 planning)

**Context**: Post-review corrections from Cycle 010 minor findings (Q-31), two deferred design questions from Cycles 007/008 (Q-26, Q-27), and one carryover from Cycle 001 (Q-3).

---

**Q: Q-31 — The unfixable Andon path (WI-124) now has an exact quoted journal template. The fixable path still says "Note in the journal as significant rework." Should both files get a quoted template for consistency?**

A: Yes — add a quoted template to the fixable path in both files to match the style established in WI-124.

---

**Q: Q-26 — When the smoke test infrastructure itself fails (not the app — e.g., port conflict, missing test runner), the current protocol is silent. What should happen?**

A: The executor should attempt to identify the root cause of the failure. If it is a regression (this work item caused the infra failure), attempt a careful surgical fix without expanding scope or making architectural decisions. If it is not a regression (pre-existing or environmental), pull the Andon cord.

---

**Q: Q-27 — P-22 and the startup-failure exception assume the project has a startup command. Library projects and other non-app contexts may not have one. How should the smoke test be defined?**

A: The smoke test concept should be generalized beyond "startup command." The heuristic is: what would a reasonable person be expected to do to demo the work they just did? A startup command, an e2e test, running a build — all are appropriate in different contexts. The code-reviewer should determine the appropriate smoke test for the context.

---

**Q: Q-3 — skills/review/SKILL.md:193 still lists spawn_session as the primary agent-spawning mechanism and Agent tool as fallback. Should it be corrected to match execute and plan?**

A: Yes — Agent tool is primary, spawn_session is an optional enhancement for installations with outpost configured.

---

**Scope boundary**: No changes to guiding principles, constraints, or architecture. All changes are to existing skill/agent definition files and the workflow policy (P-22).
