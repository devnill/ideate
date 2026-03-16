export interface Chunk {
    id: string;
    filePath: string;
    sectionPath: string[];
    content: string;
    startLine: number;
    endLine: number;
    artifactType: ArtifactType;
    domain: string | null;
    contentHash: string;
}
export type ArtifactType = "work_item" | "module" | "architecture" | "principle" | "constraint" | "research" | "journal" | "domain_policy" | "review" | "other";
export declare function chunkMarkdownFile(filePath: string, content: string): Chunk[];
/**
 * Chunk work-items.yaml: each top-level list item becomes one chunk.
 * We detect item boundaries by looking for lines that start with "- " at indent 0.
 */
export declare function chunkYamlWorkItems(filePath: string, content: string): Chunk[];
//# sourceMappingURL=chunker.d.ts.map