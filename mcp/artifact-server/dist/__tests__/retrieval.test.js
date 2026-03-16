import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { semanticSearch, logQuery } from "../retrieval.js";
// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function makeChunk(overrides = {}) {
    return {
        id: overrides.id ?? "file.md:1-10",
        filePath: overrides.filePath ?? "/test/file.md",
        sectionPath: overrides.sectionPath ?? [],
        content: overrides.content ?? "default content",
        startLine: overrides.startLine ?? 1,
        endLine: overrides.endLine ?? 10,
        artifactType: overrides.artifactType ?? "other",
        domain: overrides.domain ?? null,
        contentHash: overrides.contentHash ?? "abc123",
    };
}
function createMockIndex(candidates) {
    return {
        embed: vi.fn().mockResolvedValue(new Float32Array(384)),
        search: vi.fn().mockResolvedValue(candidates),
    };
}
// -----------------------------------------------------------------------
// semanticSearch
// -----------------------------------------------------------------------
describe("semanticSearch", () => {
    it("returns hybrid scores (0.7 semantic + 0.3 BM25)", async () => {
        const chunk = makeChunk({
            id: "a.md:1-5",
            content: "the quick brown fox jumps over the lazy dog",
        });
        const mockIndex = createMockIndex([{ chunk, similarity: 0.8 }]);
        const results = await semanticSearch(mockIndex, "quick fox", 5);
        expect(results).toHaveLength(1);
        // With a single candidate, normalized semantic = 1 (range 0), BM25 normalized = 1
        // finalScore = 0.7 * 1 + 0.3 * 1 = 1.0
        expect(results[0].finalScore).toBeCloseTo(1.0, 1);
    });
    it("boosts principles with similarity > 0.3", async () => {
        const principleChunk = makeChunk({
            id: "p.md:1-5",
            content: "guiding principle about architecture and design patterns",
            artifactType: "principle",
        });
        const otherChunk = makeChunk({
            id: "o.md:1-5",
            content: "some other content about architecture and design patterns",
            artifactType: "other",
        });
        // Different similarities to avoid normalization clamping
        const mockIndex = createMockIndex([
            { chunk: principleChunk, similarity: 0.6 },
            { chunk: otherChunk, similarity: 0.5 },
        ]);
        const results = await semanticSearch(mockIndex, "architecture design", 5);
        expect(results).toHaveLength(2);
        const principleResult = results.find((r) => r.chunk.artifactType === "principle");
        const otherResult = results.find((r) => r.chunk.artifactType === "other");
        // Principle should be boosted by +0.1, making the gap even wider
        expect(principleResult.finalScore).toBeGreaterThan(otherResult.finalScore);
    });
    it("boosts constraints with similarity > 0.3", async () => {
        const constraintChunk = makeChunk({
            id: "c.md:1-5",
            content: "constraint on system behavior and limits",
            artifactType: "constraint",
        });
        const mockIndex = createMockIndex([
            { chunk: constraintChunk, similarity: 0.5 },
        ]);
        const results = await semanticSearch(mockIndex, "system limits", 5);
        expect(results).toHaveLength(1);
        // Single candidate: normalized semantic = 1, BM25 = 1 => 0.7 + 0.3 = 1.0 + 0.1 boost = 1.0 (clamped)
        expect(results[0].finalScore).toBeLessThanOrEqual(1.0);
    });
    it("does not boost principles with similarity <= 0.3", async () => {
        const principleChunk = makeChunk({
            id: "p.md:1-5",
            content: "completely unrelated text xyz",
            artifactType: "principle",
        });
        const otherChunk = makeChunk({
            id: "o.md:1-5",
            content: "completely unrelated text xyz",
            artifactType: "other",
        });
        const mockIndex = createMockIndex([
            { chunk: principleChunk, similarity: 0.2 },
            { chunk: otherChunk, similarity: 0.2 },
        ]);
        const results = await semanticSearch(mockIndex, "search query", 5);
        const principleResult = results.find((r) => r.chunk.artifactType === "principle");
        const otherResult = results.find((r) => r.chunk.artifactType === "other");
        // No boost — both should have the same final score
        expect(principleResult.finalScore).toBeCloseTo(otherResult.finalScore, 5);
    });
    it("filters by artifact type", async () => {
        const workItem = makeChunk({
            id: "w.md:1-5",
            content: "work item about feature implementation",
            artifactType: "work_item",
        });
        const other = makeChunk({
            id: "o.md:1-5",
            content: "other document about feature implementation",
            artifactType: "other",
        });
        const mockIndex = createMockIndex([
            { chunk: workItem, similarity: 0.7 },
            { chunk: other, similarity: 0.8 },
        ]);
        const results = await semanticSearch(mockIndex, "feature", 5, {
            type: "work_item",
        });
        expect(results).toHaveLength(1);
        expect(results[0].chunk.artifactType).toBe("work_item");
    });
    it("filters by domain", async () => {
        const authChunk = makeChunk({
            id: "a.md:1-5",
            content: "authentication policy document",
            domain: "auth",
        });
        const dbChunk = makeChunk({
            id: "d.md:1-5",
            content: "database policy document",
            domain: "database",
        });
        const mockIndex = createMockIndex([
            { chunk: authChunk, similarity: 0.6 },
            { chunk: dbChunk, similarity: 0.7 },
        ]);
        const results = await semanticSearch(mockIndex, "policy", 5, {
            domain: "auth",
        });
        expect(results).toHaveLength(1);
        expect(results[0].chunk.domain).toBe("auth");
    });
    it("respects topK limit", async () => {
        const candidates = Array.from({ length: 10 }, (_, i) => ({
            chunk: makeChunk({
                id: `f${i}.md:1-5`,
                content: `document number ${i} about testing`,
            }),
            similarity: 0.9 - i * 0.05,
        }));
        const mockIndex = createMockIndex(candidates);
        const results = await semanticSearch(mockIndex, "testing", 3);
        expect(results).toHaveLength(3);
    });
    it("returns empty array when no candidates", async () => {
        const mockIndex = createMockIndex([]);
        const results = await semanticSearch(mockIndex, "anything", 5);
        expect(results).toHaveLength(0);
    });
});
// -----------------------------------------------------------------------
// logQuery
// -----------------------------------------------------------------------
describe("logQuery", () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-test-"));
        // Create the .ideate-index directory that logQuery expects
        fs.mkdirSync(path.join(tmpDir, ".ideate-index"), { recursive: true });
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    it("writes valid JSONL to the query log", () => {
        const chunk = makeChunk({ id: "test.md:1-10" });
        const results = [
            {
                chunk,
                semanticScore: 0.85,
                bm25Score: 0.6,
                finalScore: 0.775,
            },
        ];
        logQuery(tmpDir, "test query", results, "test-agent");
        const logPath = path.join(tmpDir, ".ideate-index", "query-log.jsonl");
        expect(fs.existsSync(logPath)).toBe(true);
        const lines = fs
            .readFileSync(logPath, "utf8")
            .trim()
            .split("\n");
        expect(lines).toHaveLength(1);
        const entry = JSON.parse(lines[0]);
        expect(entry.query).toBe("test query");
        expect(entry.requesting_agent).toBe("test-agent");
        expect(entry.results).toHaveLength(1);
        expect(entry.results[0].chunk_id).toBe("test.md:1-10");
        expect(entry.timestamp).toBeDefined();
    });
    it("appends multiple queries as separate JSONL lines", () => {
        const chunk = makeChunk();
        const results = [
            { chunk, semanticScore: 0.5, bm25Score: 0.3, finalScore: 0.44 },
        ];
        logQuery(tmpDir, "first query", results);
        logQuery(tmpDir, "second query", results);
        const logPath = path.join(tmpDir, ".ideate-index", "query-log.jsonl");
        const lines = fs
            .readFileSync(logPath, "utf8")
            .trim()
            .split("\n");
        expect(lines).toHaveLength(2);
        // Both lines should be valid JSON
        expect(() => JSON.parse(lines[0])).not.toThrow();
        expect(() => JSON.parse(lines[1])).not.toThrow();
    });
    it("sets requesting_agent to null when not provided", () => {
        logQuery(tmpDir, "no agent query", []);
        const logPath = path.join(tmpDir, ".ideate-index", "query-log.jsonl");
        const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
        expect(entry.requesting_agent).toBeNull();
    });
});
//# sourceMappingURL=retrieval.test.js.map