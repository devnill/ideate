# Refinement Interview — 2026-03-22 (General)

**Trigger**: User correction after Cycle 008. WI-120 made startup-failure an unconditional Andon event. User intent is the opposite: startup failure should be diagnosed and surgically fixed immediately; Andon is the fallback only when the root cause cannot be fixed.

**Q: If surgical diagnosis reveals the root cause requires changes outside the current work item's scope, should that escalate to Andon at that point, or should the executor still attempt a fix regardless?**
A: The Andon should be if we cannot fix the cause of the defect.

**Decision**: Startup failure → diagnose root cause → attempt surgical fix → Andon only if unfixable (scope change required, cause indeterminate, or fix not achievable within the work item).
