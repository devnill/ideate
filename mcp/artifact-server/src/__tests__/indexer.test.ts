import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Mock the watcher module to prevent actual file watching
vi.mock("../watcher.js", () => ({
  artifactWatcher: {
    on: vi.fn(),
    watch: vi.fn(),
  },
  FileChangeEvent: {},
}));

// Mock @xenova/transformers for embedding operations
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

import {
  artifactIndex,
  domainPolicies,
  artifactQuery,
} from "../indexer.js";

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

let tmpDir: string;

function writeFixture(relPath: string, content: string): void {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("indexer tool functions", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-test-"));

    // Set up fixture directory structure
    writeFixture(
      "steering/guiding-principles.md",
      "# Guiding Principles\n\nAlways write tests before code.\nKeep modules small and focused.\nPrefer composition over inheritance."
    );
    writeFixture(
      "steering/constraints.md",
      "# Constraints\n\nMust support Node 20+.\nNo external API calls in tests.\nMaximum 500ms response time."
    );
    writeFixture(
      "plan/architecture.md",
      "# Architecture\n\n## Components\n\nThe system has three layers:\n- API layer\n- Service layer\n- Data layer"
    );
    writeFixture(
      "plan/work-items.yaml",
      [
        "- id: 001",
        "  title: Setup project",
        "  status: done",
        "- id: 002",
        "  title: Implement auth",
        "  status: pending",
      ].join("\n")
    );
    writeFixture(
      "domains/test-domain/policies.md",
      "# Test Domain Policies\n\nAll test files must use vitest.\nMock external dependencies.\nClean up temp files in afterEach."
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("artifactIndex", () => {
    it("returns JSON listing all files in the artifact directory", async () => {
      const result = await artifactIndex(tmpDir);
      const parsed = JSON.parse(result);

      expect(parsed.artifactDir).toBe(tmpDir);
      expect(Array.isArray(parsed.files)).toBe(true);
      expect(parsed.files.length).toBeGreaterThanOrEqual(5);

      const filePaths = parsed.files.map((f: { path: string }) => f.path);
      expect(filePaths).toContain("steering/guiding-principles.md");
      expect(filePaths).toContain("steering/constraints.md");
      expect(filePaths).toContain("plan/architecture.md");
      expect(filePaths).toContain("plan/work-items.yaml");
      expect(filePaths).toContain(
        path.join("domains", "test-domain", "policies.md")
      );
    });

    it("includes file type classification", async () => {
      const result = await artifactIndex(tmpDir);
      const parsed = JSON.parse(result);

      const steering = parsed.files.find(
        (f: { path: string }) => f.path === "steering/guiding-principles.md"
      );
      expect(steering).toBeDefined();
      expect(steering.type).toBe("steering");

      const plan = parsed.files.find(
        (f: { path: string }) => f.path === "plan/architecture.md"
      );
      expect(plan).toBeDefined();
      expect(plan.type).toBe("plan");
    });
  });

  describe("domainPolicies", () => {
    it("returns content from the test-domain policies", async () => {
      const result = await domainPolicies(tmpDir);
      expect(result).toContain("test-domain");
      expect(result).toContain("vitest");
      expect(result).toContain("Mock external dependencies");
    });

    it("returns a specific domain when filtered", async () => {
      const result = await domainPolicies(tmpDir, "test-domain");
      expect(result).toContain("test-domain");
      expect(result).toContain("All test files must use vitest");
    });

    it("returns a not-found note for a nonexistent domain", async () => {
      const result = await domainPolicies(tmpDir, "nonexistent");
      expect(result).toContain("not found");
      expect(result.toLowerCase()).toContain("nonexistent");
    });

    it("returns a note when no domains directory exists", async () => {
      const emptyDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "indexer-empty-")
      );
      try {
        const result = await domainPolicies(emptyDir);
        expect(result).toContain("Note:");
        expect(result).toContain("domains");
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe("artifactQuery", () => {
    it("returns results matching the query term", async () => {
      const result = await artifactQuery(tmpDir, "guiding principles");
      expect(result).toContain("guiding-principles.md");
    });

    it("returns results for architecture query", async () => {
      const result = await artifactQuery(tmpDir, "architecture components");
      expect(result).toContain("architecture.md");
    });

    it("returns a note for queries with no matches", async () => {
      const result = await artifactQuery(tmpDir, "xyznonexistent");
      expect(result).toContain("No results found");
    });

    it("returns a note for queries with only short terms", async () => {
      const result = await artifactQuery(tmpDir, "a b");
      expect(result).toContain("at least one term");
    });
  });
});
