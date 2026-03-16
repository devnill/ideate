# 078: Conditional Domain Curator Model Selection

## Objective
Run the domain curator on sonnet by default and escalate to opus only when the review produced conflict-grade findings, reducing per-token cost for the most common (non-conflict) case.

## Acceptance Criteria
- [ ] `skills/review/SKILL.md` Phase 7.2 includes a pre-screening step before spawning the curator
- [ ] Pre-screening checks for conflict-grade findings using these concrete signals: (a) a finding references the same file scope as an existing policy, (b) a finding's severity is critical and its domain matches an existing policy's domain, (c) a finding explicitly recommends changing or removing behavior that a policy prescribes
- [ ] The pre-screening extracts policy IDs (P-N) and domain names from `domains/*/policies.md`, then checks whether any critical/significant finding in `{output-dir}/summary.md` references the same domain or file scope
- [ ] If any conflict signal is detected: curator is spawned with `model: claude-opus-4-6` (current behavior)
- [ ] If no conflict signals detected: curator is spawned with `model: sonnet` (new default)
- [ ] The curator agent definition (`agents/domain-curator.md`) default model field remains `opus` (the skill overrides at spawn time)
- [ ] The decision (which model was used and why) is logged in the journal entry for this review
- [ ] The curator's output follows the same file format and writes to the same paths regardless of which model is used

## File Scope
- `skills/review/SKILL.md` (modify)

## Dependencies
- Depends on: none
- Blocks: none

## Implementation Notes
Modify `skills/review/SKILL.md` Phase 7.2 (line 393). Insert the pre-screening logic WITHIN Phase 7.2, before the curator spawn at line 395 — not between Phase 6 and Phase 7 (which would bypass Phase 7.1's "Determine Whether Curator Runs" logic).

1. Read all `domains/*/policies.md`. Extract: policy IDs, domain names, file paths mentioned in policy derivations.
2. Read `{output-dir}/summary.md`. For each critical/significant finding, extract: domain (if stated), file paths referenced.
3. Match by domain name or file path overlap between findings and policies. Any match → opus. No match → sonnet.

If `domains/` doesn't exist (first cycle), use sonnet. False negatives are acceptable — conflicts surface next cycle.

## Complexity
Medium
