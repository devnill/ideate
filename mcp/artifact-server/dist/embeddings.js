import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------
function cosineSimilarity(a, b) {
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
    db;
    pipe = null;
    indexDir;
    constructor(artifactDir) {
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
    initSchema() {
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
    async getPipeline() {
        if (this.pipe)
            return this.pipe;
        // Dynamic import to avoid loading ONNX at startup
        const { pipeline } = await import("@xenova/transformers");
        this.pipe = (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2"));
        return this.pipe;
    }
    /** Generate embedding for a text string. */
    async embed(text) {
        const pipe = await this.getPipeline();
        const output = await pipe(text, { pooling: "mean", normalize: true });
        return output.data;
    }
    /** Upsert chunks for a file; skip unchanged (same contentHash). */
    async indexFile(filePath, chunks) {
        if (chunks.length === 0) {
            await this.removeFile(filePath);
            return;
        }
        // Load existing hashes for this file
        const existingRows = this.db
            .prepare("SELECT id, content_hash FROM chunks WHERE file_path = ?")
            .all(filePath);
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
            let embeddingBlob = null;
            try {
                const vec = await this.embed(chunk.content);
                embeddingBlob = Buffer.from(vec.buffer);
            }
            catch {
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
    async removeFile(filePath) {
        this.db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath);
    }
    /** Retrieve all chunks for a file (no embeddings — metadata only). */
    async getChunksForFile(filePath) {
        const rows = this.db
            .prepare("SELECT id, file_path, section_path, content, artifact_type, domain, content_hash FROM chunks WHERE file_path = ?")
            .all(filePath);
        return rows.map(rowToChunk);
    }
    /**
     * Cosine similarity search over all chunks with embeddings.
     * Returns top-K results sorted by similarity descending.
     */
    async search(queryEmbedding, topK) {
        const rows = this.db
            .prepare("SELECT id, file_path, section_path, content, artifact_type, domain, content_hash, embedding FROM chunks WHERE embedding IS NOT NULL")
            .all();
        const scored = [];
        for (const row of rows) {
            const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
            const sim = cosineSimilarity(queryEmbedding, vec);
            scored.push({ chunk: rowToChunk(row), similarity: sim });
        }
        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topK);
    }
}
function rowToChunk(row) {
    return {
        id: row.id,
        filePath: row.file_path,
        sectionPath: JSON.parse(row.section_path),
        content: row.content,
        startLine: parseStartLine(row.id),
        endLine: parseEndLine(row.id),
        artifactType: row.artifact_type,
        domain: row.domain,
        contentHash: row.content_hash,
    };
}
function parseStartLine(id) {
    const m = id.match(/:(\d+)-\d+$/);
    return m ? parseInt(m[1], 10) : 0;
}
function parseEndLine(id) {
    const m = id.match(/:(\d+)-(\d+)$/);
    return m ? parseInt(m[2], 10) : 0;
}
//# sourceMappingURL=embeddings.js.map