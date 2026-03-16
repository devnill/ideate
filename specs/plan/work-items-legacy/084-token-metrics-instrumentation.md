# 084: Token and Latency Metrics Instrumentation

## Objective
Add instrumentation to ideate skills so that agent token usage, turn counts, and wall-clock latency are recorded per-agent and per-phase, providing the data needed to measure the impact of optimizations.

## Acceptance Criteria
- [ ] Every agent spawn (via Agent tool) in execute, review, refine, and brrr skills records: agent type, model, start time, end time, turn count (if available from agent response metadata)
- [ ] Metrics are appended to a structured log file: `{artifact_dir}/metrics.jsonl`
- [ ] Each log entry contains: `timestamp`, `skill`, `phase`, `agent_type`, `model`, `work_item` (if applicable), `wall_clock_ms`, `turns_used` (if available), `context_files_read` (list of file paths the agent was instructed to read)
- [ ] The execute skill logs one entry per worker agent and one per incremental code-reviewer
- [ ] The review skill logs one entry per reviewer agent (code-reviewer, spec-reviewer, gap-analyst, journal-keeper, domain-curator)
- [ ] The brrr skill logs entries following the same pattern as execute and review, with an additional `cycle` field
- [ ] A summary is appended to the journal at the end of each skill invocation: total agents spawned, total wall-clock time, models used
- [ ] Metrics collection does not affect skill behavior — it is observational only
- [ ] If metrics file writing fails (permissions, disk), the skill continues without metrics (best-effort logging)

## File Scope
- `skills/execute/SKILL.md` (modify — add metrics logging instructions)
- `skills/review/SKILL.md` (modify — add metrics logging instructions)
- `skills/brrr/SKILL.md` (modify — add metrics logging instructions)
- `skills/refine/SKILL.md` (modify — add metrics logging instructions)
- `skills/plan/SKILL.md` (modify — add metrics logging instructions)

## Dependencies
- Depends on: none
- Blocks: none (but all other optimizations benefit from having metrics to measure against)

## Implementation Notes

### Entry schema

```json
{"timestamp":"...","skill":"execute","phase":"6a","agent_type":"worker","model":"sonnet","work_item":"005-auth-middleware","wall_clock_ms":45000,"context_files_read":["..."]}
```

brrr entries add a `cycle` field. `turns_used` included if available from Agent tool response, otherwise `null`.

### Collection pattern

Record wall clock time between agent spawn and return. `context_files_read` is the list from the agent's prompt (proxy for context cost, not actual reads).

### Journal summary

Append at end of each skill invocation: agents spawned, total wall clock, models used, slowest agent.

## Complexity
Low
