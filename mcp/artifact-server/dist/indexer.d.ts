import { SearchFilter } from "./retrieval.js";
/**
 * ideate_artifact_index — full artifact directory structure as JSON
 */
export declare function artifactIndex(artifactDir: string): Promise<string>;
/**
 * ideate_domain_policies — domain policies, optionally filtered
 */
export declare function domainPolicies(artifactDir: string, domain?: string): Promise<string>;
/**
 * ideate_source_index — source code index table
 */
export declare function sourceIndex(artifactDir: string, sourceDir: string, filterPath?: string): Promise<string>;
/**
 * ideate_get_context_package — the shared context package (5 sections)
 * Follows docs/context-package-spec.md exactly.
 */
export declare function getContextPackage(artifactDir: string, reviewScope?: "full" | "differential", changedFiles?: string[]): Promise<string>;
export declare function buildSourceCodeIndex(cacheKey: string, sourceDir: string, maxExportsPerFile: number, maxRows?: number): Promise<string>;
/**
 * ideate_get_work_item_context — work item spec + module + domain policies + research
 */
export declare function getWorkItemContext(artifactDir: string, workItemId: string): Promise<string>;
/**
 * ideate_artifact_query — keyword search across all artifacts
 */
export declare function artifactQuery(artifactDir: string, query: string): Promise<string>;
export declare function artifactSemanticSearch(args: {
    artifact_dir: string;
    source_dir: string;
    query: string;
    top_k: number;
    filter?: SearchFilter;
    requesting_agent?: string;
}): Promise<string>;
//# sourceMappingURL=indexer.d.ts.map