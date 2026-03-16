# 083: RAG-Based Artifact Retrieval

## Objective
Add embedding-based semantic search to the artifact MCP server, enabling agents to query artifacts by meaning rather than keyword, and receive contextually relevant chunks without reading full files.

## Acceptance Criteria
- [ ] The artifact MCP server (082) is extended with an embedding index over all artifact content
- [ ] A new tool `artifact_semantic_search(query: string, top_k?: number, filter?: {type?: string, domain?: string})` is exposed via MCP
- [ ] Artifacts are chunked at semantic boundaries (sections, work items, findings) not arbitrary byte offsets
- [ ] Each chunk retains: source file path, section heading hierarchy, byte offset range, artifact type
- [ ] The embedding index is updated incrementally when files change (re-embed only changed chunks, not the full corpus)
- [ ] Hybrid retrieval: results combine semantic similarity score with keyword match score (BM25 or equivalent)
- [ ] Critical documents (guiding-principles.md, constraints.md) are always included in results when relevance score exceeds a low threshold, to prevent principles from being filtered out
- [ ] Search results include a relevance score and source citation for each chunk
- [ ] The embedding model is configurable (default: a local model that doesn't require API calls)
- [ ] The system works offline — no external API dependencies for core functionality
- [ ] Retrieval precision is measurable: the server logs queries and returned chunks for post-hoc evaluation

## File Scope
- `mcp/artifact-server/embeddings.ts` (create — embedding generation and storage)
- `mcp/artifact-server/chunker.ts` (create — semantic chunking logic)
- `mcp/artifact-server/retrieval.ts` (create — hybrid search combining semantic + keyword)
- `mcp/artifact-server/tools.ts` (modify — add semantic search tool)
- `mcp/artifact-server/indexer.ts` (modify — integrate embedding index)
- `mcp/artifact-server/package.json` (modify — add embedding dependencies)

## Dependencies
- Depends on: 082
- Blocks: none

## Implementation Notes

### Chunking

Chunk at markdown heading boundaries. Each chunk retains its full heading hierarchy (e.g., "Architecture > Auth Module > Provides"). Chunk sizes range from 3-10 lines (journal entries, constraints) to 30-100 lines (architecture sections, work items).

### Embedding model

Default: `@xenova/transformers` with `all-MiniLM-L6-v2` (384-dim, local, no API calls). Configurable to use external APIs.

### Storage

SQLite + `sqlite-vec` at `{artifact_dir}/.ideate-index/embeddings.db`. Schema: `chunks(id, file_path, section_path, content, embedding BLOB, artifact_type, domain, updated_at)`. Gitignored.

### Incremental updates

On file change: re-chunk, compare by content hash, re-embed only changed chunks.

### Hybrid retrieval

`final_score = 0.7 * cosine_similarity + 0.3 * bm25_score`. Boost guiding principles (+0.1) and active policies (+0.05). Return top K (default 10).

### Query logging

Log to `{artifact_dir}/.ideate-index/query-log.jsonl`: timestamp, query, chunk_ids, scores, requesting_agent.

## Complexity
High
