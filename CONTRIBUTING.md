# Contributing to Ideate

Ideate uses its own workflow to develop itself. This document covers the
self-hosted development process and the key extensibility checklists you
need when adding new artifact types or edges.

---

## Self-hosted development workflow

All changes to ideate go through the ideate workflow. Direct source edits
without a backing work item are the exception, not the rule.

The `.ideate/` directory is ideate's **own** artifact directory — ideate
uses its own structured SDLC workflow on itself (meta).

### Typical cycle

| Step | Command | Purpose |
|------|---------|---------|
| Intake | `/ideate:triage` | File a bug report, feature request, or chore as a work item |
| Plan | `/ideate:refine` | Shape open work items into an executable cycle |
| Build | `/ideate:execute` | Build work items one at a time with incremental review |
| Automate | `/ideate:autopilot` | Unattended execute → review → refine loop until convergence |
| Audit | `/ideate:review` | Cross-cutting capstone review of the current cycle |

### Direct edits

Limit direct source edits (no work item) to:

- Typo / comment fixes that carry zero design risk
- Emergency hot-patches that are immediately followed by a triage entry

---

## Node-type addition checklist

When you need a new artifact type in the graph, touch these locations in
order. The compile-time guard at step 1 catches most omissions early.

1. **`mcp/artifact-server/src/node-type-registry.ts`** — Add an entry to
   `NODE_TYPE_REGISTRY`. The `satisfies Record<NodeType, NodeTypeSpec>`
   annotation causes `tsc` to error if any `NodeType` is missing a registry
   entry, so this is your compile-time safety net.

2. **`mcp/artifact-server/src/db.ts`** — If the new type is queryable, add
   a Drizzle table definition here and set `extensionTable` on the registry
   entry you created in step 1.

3. **`mcp/artifact-server/src/adapter.ts`** — Add the new type to
   `ALL_NODE_TYPES` (the runtime array) and to the `NodeType` union type
   above it. A compile-time exhaustiveness check below that array will flag
   the union if the array is out of sync.

4. **`mcp/artifact-server/src/schema.ts` + `src/migrations.ts`** — If the
   new type requires DDL changes, update `createSchema`, bump
   `CURRENT_SCHEMA_VERSION`, and add a migration entry in `migrations.ts`.

5. **`mcp/artifact-server/src/__tests__/node-type-registry.test.ts`** — Add
   regression tests covering the new entry (round-trip, extension-table
   presence, buildRow shape).

---

## Edge-type addition checklist

1. **`mcp/artifact-server/src/schema.ts`** — Add an entry to
   `EDGE_TYPE_REGISTRY` with `source_types`, `target_types`, and either
   `yaml_field` (for field-driven derivation) or `derivationPath`
   (for custom derivation logic). Document custom derivation in the
   `derivationPath` field and extend the indexer accordingly.

2. **`mcp/artifact-server/src/ppr.ts`** — Add a weight to
   `DEFAULT_EDGE_TYPE_WEIGHTS`. Every registered edge type must have an
   explicit entry; omissions silently default to 1.0 and skip PPR tuning.

---

## Testing conventions

- **Runtime:** Node 22 + vitest only. Never use `bun test` or `bunx`.
- **Lint + type-check + test:** `npm test` runs `tsc --noEmit && vitest run`.
- **Test locations:**
  - `mcp/artifact-server/src/__tests__/` — flat unit and integration tests
    (colocate new tests here by default)
  - `mcp/artifact-server/tests/adapters/` — adapter-equivalence suite
    (gated on a live backend; run separately)

---

## Class-of-bug fixes

When a review finds a bug that represents a pattern (e.g., fs I/O inside SQLite transaction, divergent copies of a constant, missing shutdown guard), fixing only the named file is not sufficient.

**Before marking the WI done**:
1. Grep for the pattern across the entire codebase.
2. Fix every occurrence, or explicitly defer with rationale.
3. Include the grep results in the completion report.

This policy is codified as **P-95** (workflow domain). Historical examples: WI-890 fixed one function out of three, WI-891 fixed Remote but not Local, WI-897 left 3 local helpers in place. Each required a fixup cycle that grep-verification would have prevented.

**Related**: **P-96** — consolidation WIs must verify via grep in their self-check, not self-report.

---

## MCP abstraction boundary (GP-14)

Skills and agents **must** use MCP tools for all `.ideate/` reads and
writes. Direct filesystem access to `.ideate/` is prohibited for workers.

- Permission deny rules enforcing this live in `.claude/settings.json`
  (configured per WI-916).
- MCP tools are registered in the `TOOLS` array in
  `mcp/artifact-server/src/tools/index.ts`. Add new tools there so the
  server advertises them to clients.
- Do not bypass MCP by importing adapter or schema modules directly from
  skill or agent scripts.
