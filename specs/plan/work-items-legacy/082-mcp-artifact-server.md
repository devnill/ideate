# 082: MCP Artifact Server

## Objective
Build an MCP server that loads, indexes, and serves ideate artifact content on demand, replacing the pattern of multiple Read/Glob tool calls per agent with single focused queries.

## Acceptance Criteria
- [ ] An MCP server exists that can be configured in Claude Code's MCP settings
- [ ] The server exposes at least these tools:
  - `artifact_context(work_item: string)` — returns the work item spec + relevant module spec + applicable domain policies + relevant research, pre-assembled
  - `artifact_context(review_scope: "full" | "differential", changed_files?: string[])` — returns the shared context package for review agents
  - `artifact_query(query: string)` — free-text search across all artifacts, returns relevant chunks with source citations
  - `artifact_index()` — returns the full artifact directory structure with metadata (file sizes, last modified, type classification)
  - `domain_policies(domain?: string)` — returns active policies, optionally filtered by domain
  - `source_index(path?: string)` — returns the source code index (file tree + key exports) for the project or a subtree
- [ ] The server loads artifacts from a specified artifact directory (configurable)
- [ ] The server watches for file changes and invalidates cached entries when underlying files change
- [ ] Query results include source citations (file path + section) so agents can Read the full source if needed
- [ ] The server handles missing files gracefully (returns empty results with a note, does not crash)
- [ ] The server can be started/stopped independently of Claude Code sessions
- [ ] Response sizes are bounded — large artifacts are summarized with a pointer to the full file
- [ ] The server works with the existing skill prompts — skills can use MCP tools alongside Read/Glob/Grep
- [ ] `skills/review/SKILL.md` Phase 3.6 is updated with an MCP availability check: if `mcp__artifact_server__artifact_context` is available, use it for context assembly; otherwise fall back to Read/Glob (proof of integration)
- [ ] The availability check pattern is documented in `docs/context-package-spec.md` (from 079) so other skills can adopt it

## File Scope
- `mcp/artifact-server/` (create — new directory for the MCP server)
- `mcp/artifact-server/index.ts` (create — server entry point)
- `mcp/artifact-server/tools.ts` (create — tool definitions)
- `mcp/artifact-server/indexer.ts` (create — artifact indexing and caching logic)
- `mcp/artifact-server/watcher.ts` (create — file change detection)
- `mcp/artifact-server/package.json` (create)
- `mcp/artifact-server/tsconfig.json` (create)
- `mcp/artifact-server/README.md` (create)
- `skills/review/SKILL.md` (modify — add MCP availability check to Phase 3.6)
- `docs/context-package-spec.md` (modify — add availability check pattern documentation)

## Dependencies
- Depends on: 079 (read `docs/context-package-spec.md` for the context package format the server must replicate)
- Blocks: 083

## Implementation Notes

### Indexing

On startup and file change, classify files by artifact type, extract metadata (work item fields, domain entry IDs, review verdicts), and build relationship maps (work item → module, file scope → work item). Keyword index for `artifact_query` (not embeddings — that's 083).

### Caching

In-memory, per-file, invalidated on mtime change via `chokidar`. Assembled context packages cached with composite keys. Bound at 50MB LRU.

### Response size bounds

- `artifact_context(work_item)`: ~200-500 lines. Summarize research if >1000 lines.
- `artifact_context(review_scope)`: ~500-800 lines (matches 079's shared context package).
- `artifact_query`: top 10 chunks, each ≤50 lines, with source citations.

### Technology

TypeScript, `@modelcontextprotocol/sdk`, `chokidar`. No database — artifact directory is source of truth, server is a read-through cache. Read-only access.

### Integration

Additive — skills check for MCP tool availability and fall back to Read/Glob if not configured.

## Complexity
High
