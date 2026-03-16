import type { Chunk } from "./chunker.js";
import type { EmbeddingIndex } from "./embeddings.js";
export interface SearchResult {
    chunk: Chunk;
    semanticScore: number;
    bm25Score: number;
    finalScore: number;
}
export interface SearchFilter {
    type?: string;
    domain?: string;
}
export declare function semanticSearch(index: EmbeddingIndex, query: string, topK: number, filter?: SearchFilter): Promise<SearchResult[]>;
export declare function logQuery(artifactDir: string, query: string, results: SearchResult[], requestingAgent?: string): void;
//# sourceMappingURL=retrieval.d.ts.map