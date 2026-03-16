import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Chunk } from "../chunker.js";

// -----------------------------------------------------------------------
// Mock @xenova/transformers
// -----------------------------------------------------------------------

/**
 * Simple PRNG seeded from text hash — produces deterministic 384-dim vectors.
 */
function hashToVector(text: string): Float32Array {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  const vec = new Float32Array(384);
  let state = hash;
  for (let i = 0; i < 384; i++) {
    state = (state * 1103515245 + 12345) | 0;
    vec[i] = ((state >>> 16) & 0x7fff) / 0x7fff;
  }
  // Normalize to unit vector
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) vec[i] /= norm;
  return vec;
}

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(
    async (text: string, _options?: Record<string, unknown>) => ({
      data: hashToVector(text),
    })
  ),
}));

// Import after mock is set up
import { EmbeddingIndex } from "../embeddings.js";

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: overrides.id ?? "file.md:1-10",
    filePath: overrides.filePath ?? "/test/file.md",
    sectionPath: overrides.sectionPath ?? [],
    content: overrides.content ?? "default test content for embedding",
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 10,
    artifactType: overrides.artifactType ?? "other",
    domain: overrides.domain ?? null,
    contentHash: overrides.contentHash ?? "hash1",
  };
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("EmbeddingIndex", () => {
  let tmpDir: string;
  let index: EmbeddingIndex;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embeddings-test-"));
    index = new EmbeddingIndex(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates the .ideate-index directory", () => {
      const indexDir = path.join(tmpDir, ".ideate-index");
      expect(fs.existsSync(indexDir)).toBe(true);
    });

    it("creates a .gitignore in the index directory", () => {
      const gitignorePath = path.join(tmpDir, ".ideate-index", ".gitignore");
      expect(fs.existsSync(gitignorePath)).toBe(true);
      expect(fs.readFileSync(gitignorePath, "utf8")).toBe("*\n");
    });

    it("creates the SQLite database file", () => {
      const dbPath = path.join(tmpDir, ".ideate-index", "embeddings.db");
      expect(fs.existsSync(dbPath)).toBe(true);
    });
  });

  describe("indexFile", () => {
    it("inserts new chunks into the database", async () => {
      const chunks = [
        makeChunk({
          id: "/test/doc.md:1-5",
          filePath: "/test/doc.md",
          content: "first chunk content for testing",
          contentHash: "aaa",
        }),
        makeChunk({
          id: "/test/doc.md:6-10",
          filePath: "/test/doc.md",
          content: "second chunk content for testing",
          contentHash: "bbb",
        }),
      ];

      await index.indexFile("/test/doc.md", chunks);

      const stored = await index.getChunksForFile("/test/doc.md");
      expect(stored).toHaveLength(2);
      expect(stored.map((c) => c.id).sort()).toEqual(
        ["/test/doc.md:1-5", "/test/doc.md:6-10"].sort()
      );
    });

    it("skips unchanged chunks (same contentHash)", async () => {
      const chunk = makeChunk({
        id: "/test/doc.md:1-5",
        filePath: "/test/doc.md",
        content: "unchanged content",
        contentHash: "same_hash",
      });

      await index.indexFile("/test/doc.md", [chunk]);
      // Index again with the same hash — should not re-embed
      await index.indexFile("/test/doc.md", [chunk]);

      const stored = await index.getChunksForFile("/test/doc.md");
      expect(stored).toHaveLength(1);
      expect(stored[0].contentHash).toBe("same_hash");
    });

    it("deletes stale chunks when file is re-indexed with fewer chunks", async () => {
      const chunks = [
        makeChunk({
          id: "/test/doc.md:1-5",
          filePath: "/test/doc.md",
          content: "chunk one",
          contentHash: "h1",
        }),
        makeChunk({
          id: "/test/doc.md:6-10",
          filePath: "/test/doc.md",
          content: "chunk two",
          contentHash: "h2",
        }),
      ];

      await index.indexFile("/test/doc.md", chunks);

      // Re-index with only one chunk
      await index.indexFile("/test/doc.md", [chunks[0]]);

      const stored = await index.getChunksForFile("/test/doc.md");
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe("/test/doc.md:1-5");
    });

    it("removes all chunks when passed an empty array", async () => {
      const chunk = makeChunk({
        id: "/test/doc.md:1-5",
        filePath: "/test/doc.md",
        contentHash: "h1",
      });

      await index.indexFile("/test/doc.md", [chunk]);
      await index.indexFile("/test/doc.md", []);

      const stored = await index.getChunksForFile("/test/doc.md");
      expect(stored).toHaveLength(0);
    });
  });

  describe("removeFile", () => {
    it("removes all chunks for a given file path", async () => {
      const chunks = [
        makeChunk({
          id: "/test/a.md:1-5",
          filePath: "/test/a.md",
          content: "file a content",
          contentHash: "ha",
        }),
        makeChunk({
          id: "/test/b.md:1-5",
          filePath: "/test/b.md",
          content: "file b content",
          contentHash: "hb",
        }),
      ];

      await index.indexFile("/test/a.md", [chunks[0]]);
      await index.indexFile("/test/b.md", [chunks[1]]);

      await index.removeFile("/test/a.md");

      const aChunks = await index.getChunksForFile("/test/a.md");
      const bChunks = await index.getChunksForFile("/test/b.md");
      expect(aChunks).toHaveLength(0);
      expect(bChunks).toHaveLength(1);
    });
  });

  describe("search", () => {
    it("returns results ranked by cosine similarity", async () => {
      // Index three chunks with different content
      const chunks = [
        makeChunk({
          id: "/test/doc.md:1-5",
          filePath: "/test/doc.md",
          content: "authentication and user login security",
          contentHash: "h1",
        }),
        makeChunk({
          id: "/test/doc.md:6-10",
          filePath: "/test/doc.md",
          content: "database schema and migration strategy",
          contentHash: "h2",
        }),
        makeChunk({
          id: "/test/doc.md:11-15",
          filePath: "/test/doc.md",
          content: "authentication oauth tokens and session management",
          contentHash: "h3",
        }),
      ];

      await index.indexFile("/test/doc.md", chunks);

      // Search with a query embedding — use the embed method
      const queryVec = await index.embed("authentication security");
      const results = await index.search(queryVec, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);

      // Results should be sorted by similarity descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(
          results[i].similarity
        );
      }
    });

    it("respects topK limit", async () => {
      const chunks = Array.from({ length: 5 }, (_, i) =>
        makeChunk({
          id: `/test/doc.md:${i * 5 + 1}-${i * 5 + 5}`,
          filePath: "/test/doc.md",
          content: `chunk number ${i} with unique content word${i}`,
          contentHash: `hash${i}`,
        })
      );

      await index.indexFile("/test/doc.md", chunks);

      const queryVec = await index.embed("some query");
      const results = await index.search(queryVec, 2);
      expect(results).toHaveLength(2);
    });

    it("returns empty array when no chunks have embeddings", async () => {
      // Fresh index with no data
      const queryVec = await index.embed("anything");
      const results = await index.search(queryVec, 5);
      expect(results).toHaveLength(0);
    });
  });
});
