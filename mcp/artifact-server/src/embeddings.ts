import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { Chunk } from "./chunker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// We import @xenova/transformers dynamically to avoid loading ONNX at module
// load time (it's slow and only needed on first search).
type Pipeline = (text: string, options?: Record<string, unknown>) => Promise<{ data: Float32Array }>;

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

// ---------------------------------------------------------------------------
// EmbeddingIndex
// ---------------------------------------------------------------------------

export class EmbeddingIndex {
  private db: Database.Database;
  private pipe: Pipeline | null = null;
  private indexDir: string;

  constructor(artifactDir: string) {
    this.indexDir = path.join(artifactDir, ".ideate-index");

    // Ensure directory exists
    if (!fs.existsSync(this.indexDir)) {
      fs.mkdirSync(this.indexDir, { recursive: true });
    }

    // Write .gitignore if missing
    const gitignorePath = path.join(this.indexDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "*\n", "utf8");
    }

    // Open (or create) the SQLite database
    const dbPath = path.join(this.indexDir, "embeddings.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        section_path TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        artifact_type TEXT NOT NULL,
        domain TEXT,
        content_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_file_path ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_artifact_type ON chunks(artifact_type);
    `);
  }

  /** Lazy-load the embedding pipeline. */
  private async getPipeline(): Promise<Pipeline> {
    if (this.pipe) return this.pipe;

    // Dynamic import to avoid loading ONNX at startup
    const { pipeline } = await import("@xenova/transformers");
    this.pipe = (await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    )) as unknown as Pipeline;
    return this.pipe;
  }

  /** Generate embedding for a text string. */
  async embed(text: string): Promise<Float32Array> {
    const pipe = await this.getPipeline();
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return output.data;
  }

  /** Upsert chunks for a file; skip unchanged (same contentHash). */
  async indexFile(filePath: string, chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) {
      await this.removeFile(filePath);
      return;
    }

    // Load existing hashes for this file
    const existingRows = this.db
      .prepare("SELECT id, content_hash FROM chunks WHERE file_path = ?")
      .all(filePath) as { id: string; content_hash: string }[];

    const existingByHash = new Map(existingRows.map((r) => [r.id, r.content_hash]));
    const newIds = new Set(chunks.map((c) => c.id));

    // Delete chunks no longer present
    for (const { id } of existingRows) {
      if (!newIds.has(id)) {
        this.db.prepare("DELETE FROM chunks WHERE id = ?").run(id);
      }
    }

    // Upsert changed or new chunks
    const upsert = this.db.prepare(`
      INSERT INTO chunks (id, file_path, section_path, content, embedding, artifact_type, domain, content_hash, updated_at)
      VALUES (@id, @file_path, @section_path, @content, @embedding, @artifact_type, @domain, @content_hash, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        embedding = excluded.embedding,
        section_path = excluded.section_path,
        artifact_type = excluded.artifact_type,
        domain = excluded.domain,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `);

    const now = Date.now();

    for (const chunk of chunks) {
      const existingHash = existingByHash.get(chunk.id);
      if (existingHash === chunk.contentHash) {
        // Unchanged — skip re-embedding
        continue;
      }

      let embeddingBlob: Buffer | null = null;
      try {
        const vec = await this.embed(chunk.content);
        embeddingBlob = Buffer.from(vec.buffer);
      } catch {
        // Embedding failure is non-fatal; chunk will have no embedding
        embeddingBlob = null;
      }

      upsert.run({
        id: chunk.id,
        file_path: chunk.filePath,
        section_path: JSON.stringify(chunk.sectionPath),
        content: chunk.content,
        embedding: embeddingBlob,
        artifact_type: chunk.artifactType,
        domain: chunk.domain ?? null,
        content_hash: chunk.contentHash,
        updated_at: now,
      });
    }
  }

  /** Remove all chunks for a given file. */
  async removeFile(filePath: string): Promise<void> {
    this.db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath);
  }

  /** Retrieve all chunks for a file (no embeddings — metadata only). */
  async getChunksForFile(filePath: string): Promise<Chunk[]> {
    const rows = this.db
      .prepare(
        "SELECT id, file_path, section_path, content, artifact_type, domain, content_hash FROM chunks WHERE file_path = ?"
      )
      .all(filePath) as DbRow[];
    return rows.map(rowToChunk);
  }

  /**
   * Cosine similarity search over all chunks with embeddings.
   * Returns top-K results sorted by similarity descending.
   */
  async search(
    queryEmbedding: Float32Array,
    topK: number
  ): Promise<Array<{ chunk: Chunk; similarity: number }>> {
    const rows = this.db
      .prepare(
        "SELECT id, file_path, section_path, content, artifact_type, domain, content_hash, embedding FROM chunks WHERE embedding IS NOT NULL"
      )
      .all() as (DbRow & { embedding: Buffer })[];

    const scored: Array<{ chunk: Chunk; similarity: number }> = [];

    for (const row of rows) {
      const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const sim = cosineSimilarity(queryEmbedding, vec);
      scored.push({ chunk: rowToChunk(row), similarity: sim });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface DbRow {
  id: string;
  file_path: string;
  section_path: string;
  content: string;
  artifact_type: string;
  domain: string | null;
  content_hash: string;
  embedding?: Buffer;
}

function rowToChunk(row: DbRow): Chunk {
  return {
    id: row.id,
    filePath: row.file_path,
    sectionPath: JSON.parse(row.section_path) as string[],
    content: row.content,
    startLine: parseStartLine(row.id),
    endLine: parseEndLine(row.id),
    artifactType: row.artifact_type as Chunk["artifactType"],
    domain: row.domain,
    contentHash: row.content_hash,
  };
}

function parseStartLine(id: string): number {
  const m = id.match(/:(\d+)-\d+$/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseEndLine(id: string): number {
  const m = id.match(/:(\d+)-(\d+)$/);
  return m ? parseInt(m[2], 10) : 0;
}
