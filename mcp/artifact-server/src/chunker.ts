import crypto from "crypto";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export type ArtifactType =
  | "work_item"
  | "module"
  | "architecture"
  | "principle"
  | "constraint"
  | "research"
  | "journal"
  | "domain_policy"
  | "review"
  | "other";

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function classifyArtifactType(filePath: string): ArtifactType {
  const norm = filePath.replace(/\\/g, "/");
  if (norm.includes("/plan/work-items/") || norm.includes("/work-items.yaml"))
    return "work_item";
  if (norm.includes("/plan/modules/")) return "module";
  if (norm.includes("/plan/architecture")) return "architecture";
  if (norm.includes("/steering/guiding-principles")) return "principle";
  if (norm.includes("/steering/constraints")) return "constraint";
  if (norm.includes("/steering/research") || norm.includes("/steering/interviews"))
    return "research";
  if (norm.includes("journal")) return "journal";
  if (norm.includes("/domains/") && norm.includes("/policies")) return "domain_policy";
  if (norm.includes("/archive/")) return "review";
  return "other";
}

function extractDomain(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, "/");
  const match = norm.match(/\/domains\/([^/]+)\//);
  return match ? match[1] : null;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Markdown chunker
// ---------------------------------------------------------------------------

interface HeadingBoundary {
  line: number; // 0-based
  depth: number;
  title: string;
}

/**
 * Parse heading positions from markdown content (0-based line indices).
 */
function parseHeadings(lines: string[]): HeadingBoundary[] {
  const headings: HeadingBoundary[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (m) {
      headings.push({ line: i, depth: m[1].length, title: m[2].trim() });
    }
  }
  return headings;
}

/**
 * Build a chunk from a range of lines, updating the heading stack.
 */
function makeChunk(
  filePath: string,
  lines: string[],
  startLine: number, // 0-based
  endLine: number, // 0-based inclusive
  sectionPath: string[],
  artifactType: ArtifactType,
  domain: string | null
): Chunk | null {
  const chunkLines = lines.slice(startLine, endLine + 1);
  const content = chunkLines.join("\n").trim();
  if (content.length === 0) return null;
  // Require at least 3 lines or 50 chars of real content
  const nonEmpty = chunkLines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 2 && content.length < 50) return null;

  const id = `${filePath}:${startLine + 1}-${endLine + 1}`;
  return {
    id,
    filePath,
    sectionPath: [...sectionPath],
    content,
    startLine: startLine + 1, // 1-based
    endLine: endLine + 1,
    artifactType,
    domain,
    contentHash: sha256(content),
  };
}

export function chunkMarkdownFile(filePath: string, content: string): Chunk[] {
  const artifactType = classifyArtifactType(filePath);
  const domain = extractDomain(filePath);
  const lines = content.split("\n");
  const headings = parseHeadings(lines);

  if (headings.length === 0) {
    // No headings: treat whole file as one chunk
    const chunk = makeChunk(filePath, lines, 0, lines.length - 1, [], artifactType, domain);
    return chunk ? [chunk] : [];
  }

  const chunks: Chunk[] = [];
  // Stack tracks current heading hierarchy: [{ depth, title }]
  const stack: { depth: number; title: string }[] = [];

  // Helper: get current sectionPath from stack
  const getSectionPath = () => stack.map((s) => s.title);

  // Gather boundary indices for each heading
  // Each section spans from its heading line to just before the next heading at same or higher level
  // We'll process section by section

  // Build section ranges: [startLine, endLine] for each heading
  interface Section {
    headingLine: number;
    endLine: number;
    depth: number;
    title: string;
  }

  const sections: Section[] = headings.map((h, i) => {
    const nextSameLevelOrHigher = headings
      .slice(i + 1)
      .find((nh) => nh.depth <= h.depth);
    const endLine = nextSameLevelOrHigher
      ? nextSameLevelOrHigher.line - 1
      : lines.length - 1;
    return { headingLine: h.line, endLine, depth: h.depth, title: h.title };
  });

  // Emit a pre-heading chunk (content before first heading)
  if (headings[0].line > 0) {
    const pre = makeChunk(
      filePath,
      lines,
      0,
      headings[0].line - 1,
      [],
      artifactType,
      domain
    );
    if (pre) chunks.push(pre);
  }

  for (const section of sections) {
    // Update stack: pop entries at same or deeper depth
    while (stack.length > 0 && stack[stack.length - 1].depth >= section.depth) {
      stack.pop();
    }
    stack.push({ depth: section.depth, title: section.title });

    // Find where the heading's own body ends (before first child heading)
    const firstChild = headings.find(
      (h) => h.line > section.headingLine && h.line <= section.endLine && h.depth > section.depth
    );
    const bodyEnd = firstChild ? firstChild.line - 1 : section.endLine;

    const chunk = makeChunk(
      filePath,
      lines,
      section.headingLine,
      bodyEnd,
      getSectionPath(),
      artifactType,
      domain
    );
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// YAML work-items chunker
// ---------------------------------------------------------------------------

/**
 * Chunk work-items.yaml: each top-level list item becomes one chunk.
 * We detect item boundaries by looking for lines that start with "- " at indent 0.
 */
export function chunkYamlWorkItems(filePath: string, content: string): Chunk[] {
  const artifactType: ArtifactType = "work_item";
  const domain: string | null = null;
  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  let itemStart: number | null = null;

  const flush = (end: number) => {
    if (itemStart === null) return;
    const chunk = makeChunk(filePath, lines, itemStart, end, [], artifactType, domain);
    if (chunk) chunks.push(chunk);
    itemStart = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^- /)) {
      // New top-level item
      flush(i - 1);
      itemStart = i;
    }
  }
  // Flush last item
  if (itemStart !== null) {
    flush(lines.length - 1);
  }

  return chunks;
}
