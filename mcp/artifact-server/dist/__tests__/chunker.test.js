import { describe, it, expect } from "vitest";
import { chunkMarkdownFile, chunkYamlWorkItems } from "../chunker.js";
// -----------------------------------------------------------------------
// chunkMarkdownFile
// -----------------------------------------------------------------------
describe("chunkMarkdownFile", () => {
    it("returns the whole file as one chunk when there are no headings", () => {
        const content = [
            "This is a plain file with no headings.",
            "It has enough content to pass the minimum size filter.",
            "A third line to be safe.",
        ].join("\n");
        const chunks = chunkMarkdownFile("/foo/other/notes.md", content);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].content).toBe(content);
        expect(chunks[0].sectionPath).toEqual([]);
        expect(chunks[0].startLine).toBe(1);
        expect(chunks[0].endLine).toBe(3);
    });
    it("produces chunks for nested headings (## under #)", () => {
        const content = [
            "# Top Level",
            "Top body line 1",
            "Top body line 2",
            "## Sub Section",
            "Sub body line 1",
            "Sub body line 2",
            "Sub body line 3",
        ].join("\n");
        const chunks = chunkMarkdownFile("/foo/other/doc.md", content);
        // Should produce at least a chunk for "# Top Level" and "## Sub Section"
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        const topChunk = chunks.find((c) => c.sectionPath.includes("Top Level"));
        expect(topChunk).toBeDefined();
        const subChunk = chunks.find((c) => c.sectionPath.includes("Sub Section"));
        expect(subChunk).toBeDefined();
        expect(subChunk.sectionPath).toEqual(["Top Level", "Sub Section"]);
    });
    it("emits a pre-heading chunk when content precedes the first heading", () => {
        const content = [
            "Preamble line 1",
            "Preamble line 2",
            "Preamble line 3",
            "# First Heading",
            "Body of first heading",
            "Body line 2",
            "Body line 3",
        ].join("\n");
        const chunks = chunkMarkdownFile("/foo/other/doc.md", content);
        // The first chunk should be the pre-heading content
        expect(chunks[0].sectionPath).toEqual([]);
        expect(chunks[0].content).toContain("Preamble");
        expect(chunks[0].startLine).toBe(1);
    });
    it("filters out very short content (min-size)", () => {
        // Content with no headings, only 1 non-empty line, and < 50 chars
        const content = "x";
        const chunks = chunkMarkdownFile("/foo/other/tiny.md", content);
        // makeChunk requires >= 2 non-empty lines or >= 50 chars
        expect(chunks).toHaveLength(0);
    });
    // -----------------------------------------------------------------------
    // classifyArtifactType (tested indirectly)
    // -----------------------------------------------------------------------
    describe("classifyArtifactType (indirect)", () => {
        const bigBody = "\n" + Array(5).fill("Content line here for size").join("\n");
        it("classifies work_item from path", () => {
            const chunks = chunkMarkdownFile("/foo/plan/work-items/001-setup.md", "# Setup" + bigBody);
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].artifactType).toBe("work_item");
        });
        it("classifies module from path", () => {
            const chunks = chunkMarkdownFile("/foo/plan/modules/auth.md", "# Auth" + bigBody);
            expect(chunks[0].artifactType).toBe("module");
        });
        it("classifies architecture from path", () => {
            const chunks = chunkMarkdownFile("/foo/plan/architecture.md", "# Architecture" + bigBody);
            expect(chunks[0].artifactType).toBe("architecture");
        });
        it("classifies principle from path", () => {
            const chunks = chunkMarkdownFile("/foo/steering/guiding-principles.md", "# Principles" + bigBody);
            expect(chunks[0].artifactType).toBe("principle");
        });
        it("classifies constraint from path", () => {
            const chunks = chunkMarkdownFile("/foo/steering/constraints.md", "# Constraints" + bigBody);
            expect(chunks[0].artifactType).toBe("constraint");
        });
        it("classifies research from steering/research path", () => {
            const chunks = chunkMarkdownFile("/foo/steering/research/topic.md", "# Research" + bigBody);
            expect(chunks[0].artifactType).toBe("research");
        });
        it("classifies research from steering/interviews path", () => {
            const chunks = chunkMarkdownFile("/foo/steering/interviews/user1.md", "# Interview" + bigBody);
            expect(chunks[0].artifactType).toBe("research");
        });
        it("classifies journal from path", () => {
            const chunks = chunkMarkdownFile("/foo/journal.md", "# Journal" + bigBody);
            expect(chunks[0].artifactType).toBe("journal");
        });
        it("classifies domain_policy from path", () => {
            const chunks = chunkMarkdownFile("/foo/domains/auth/policies.md", "# Policies" + bigBody);
            expect(chunks[0].artifactType).toBe("domain_policy");
        });
        it("classifies review from archive path", () => {
            const chunks = chunkMarkdownFile("/foo/archive/cycles/001/review.md", "# Review" + bigBody);
            expect(chunks[0].artifactType).toBe("review");
        });
        it("classifies other for unrecognized paths", () => {
            const chunks = chunkMarkdownFile("/foo/random/file.md", "# Random" + bigBody);
            expect(chunks[0].artifactType).toBe("other");
        });
    });
    // -----------------------------------------------------------------------
    // extractDomain (tested indirectly)
    // -----------------------------------------------------------------------
    describe("extractDomain (indirect)", () => {
        const bigBody = "\n" + Array(5).fill("Content line here for size").join("\n");
        it("extracts domain from domains path", () => {
            const chunks = chunkMarkdownFile("/foo/domains/auth/policies.md", "# Auth Policies" + bigBody);
            expect(chunks[0].domain).toBe("auth");
        });
        it("returns null domain for non-domains path", () => {
            const chunks = chunkMarkdownFile("/foo/plan/architecture.md", "# Architecture" + bigBody);
            expect(chunks[0].domain).toBeNull();
        });
    });
    // -----------------------------------------------------------------------
    // Content hash determinism
    // -----------------------------------------------------------------------
    it("produces deterministic content hashes for the same content", () => {
        const content = "# Heading\nLine one\nLine two\nLine three\nLine four";
        const chunks1 = chunkMarkdownFile("/a/doc.md", content);
        const chunks2 = chunkMarkdownFile("/b/doc.md", content);
        expect(chunks1.length).toBeGreaterThan(0);
        expect(chunks1[0].contentHash).toBe(chunks2[0].contentHash);
    });
});
// -----------------------------------------------------------------------
// chunkYamlWorkItems
// -----------------------------------------------------------------------
describe("chunkYamlWorkItems", () => {
    it("chunks multiple YAML work items on `- ` boundaries", () => {
        const content = [
            "- id: 001",
            "  title: First item",
            "  description: This is the first work item",
            "  status: pending",
            "- id: 002",
            "  title: Second item",
            "  description: This is the second work item",
            "  status: done",
        ].join("\n");
        const chunks = chunkYamlWorkItems("/foo/plan/work-items.yaml", content);
        expect(chunks).toHaveLength(2);
        expect(chunks[0].content).toContain("001");
        expect(chunks[1].content).toContain("002");
        expect(chunks[0].artifactType).toBe("work_item");
        expect(chunks[1].artifactType).toBe("work_item");
    });
    it("handles a single YAML work item", () => {
        const content = [
            "- id: only",
            "  title: Only item",
            "  description: The sole work item in the file",
        ].join("\n");
        const chunks = chunkYamlWorkItems("/foo/plan/work-items.yaml", content);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].content).toContain("only");
    });
});
//# sourceMappingURL=chunker.test.js.map