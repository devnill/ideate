import type { Chunk } from "./chunker.js";
export declare class EmbeddingIndex {
    private db;
    private pipe;
    private indexDir;
    constructor(artifactDir: string);
    private initSchema;
    /** Lazy-load the embedding pipeline. */
    private getPipeline;
    /** Generate embedding for a text string. */
    embed(text: string): Promise<Float32Array>;
    /** Upsert chunks for a file; skip unchanged (same contentHash). */
    indexFile(filePath: string, chunks: Chunk[]): Promise<void>;
    /** Remove all chunks for a given file. */
    removeFile(filePath: string): Promise<void>;
    /** Retrieve all chunks for a file (no embeddings — metadata only). */
    getChunksForFile(filePath: string): Promise<Chunk[]>;
    /**
     * Cosine similarity search over all chunks with embeddings.
     * Returns top-K results sorted by similarity descending.
     */
    search(queryEmbedding: Float32Array, topK: number): Promise<Array<{
        chunk: Chunk;
        similarity: number;
    }>>;
}
//# sourceMappingURL=embeddings.d.ts.map