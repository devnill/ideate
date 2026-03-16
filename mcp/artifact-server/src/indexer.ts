import fs from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";
import { LRUCache } from "lru-cache";
import { artifactWatcher, FileChangeEvent } from "./watcher.js";
import { EmbeddingIndex } from "./embeddings.js";
import { chunkMarkdownFile, chunkYamlWorkItems } from "./chunker.js";
import { semanticSearch, logQuery, SearchFilter } from "./retrieval.js";

// ---------------------------------------------------------------------------
// LRU Cache — 50MB bound, keyed by tool:artifactDir:...args
// ---------------------------------------------------------------------------

const CACHE_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

const cache = new LRUCache<string, string>({
  maxSize: CACHE_MAX_SIZE,
  sizeCalculation: (value) => Buffer.byteLength(value, "utf8"),
});

/** Track which cache keys depend on which absolute file paths */
const fileToCacheKeys = new Map<string, Set<string>>();

function registerDependency(cacheKey: string, filePath: string): void {
  const abs = path.resolve(filePath);
  if (!fileToCacheKeys.has(abs)) {
    fileToCacheKeys.set(abs, new Set());
  }
  fileToCacheKeys.get(abs)!.add(cacheKey);
}

function invalidateCacheForFile(filePath: string): void {
  const abs = path.resolve(filePath);
  const keys = fileToCacheKeys.get(abs);
  if (keys) {
    for (const key of keys) {
      cache.delete(key);
    }
    fileToCacheKeys.delete(abs);
  }
}

// Wire up watcher → cache invalidation
artifactWatcher.on("change", ({ filePath }: FileChangeEvent) => {
  invalidateCacheForFile(filePath);
});

// ---------------------------------------------------------------------------
// Embedding index — one per artifactDir, lazy-initialized
// ---------------------------------------------------------------------------

const embeddingIndexes = new Map<string, EmbeddingIndex>();
/** Track which artifactDir a given absolute file path belongs to, for watcher re-index */
const fileToArtifactDir = new Map<string, string>();

function getOrCreateEmbeddingIndex(artifactDir: string): EmbeddingIndex {
  if (!embeddingIndexes.has(artifactDir)) {
    embeddingIndexes.set(artifactDir, new EmbeddingIndex(artifactDir));
  }
  return embeddingIndexes.get(artifactDir)!;
}

/** Wire watcher events to re-index changed files in the embedding index */
artifactWatcher.on("change", ({ artifactDir, filePath }: FileChangeEvent) => {
  const idx = embeddingIndexes.get(artifactDir);
  if (!idx) return; // Index not yet created for this dir — nothing to update

  // Run async without blocking the event loop; errors are non-fatal
  reindexFile(idx, filePath).catch(() => {});
});

async function reindexFile(idx: EmbeddingIndex, filePath: string): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    // File deleted — remove its chunks
    await idx.removeFile(filePath);
    return;
  }

  const chunks = deriveChunks(filePath, content);
  await idx.indexFile(filePath, chunks);
}

function deriveChunks(filePath: string, content: string) {
  if (filePath.endsWith("work-items.yaml") || filePath.endsWith("work-items.yml")) {
    return chunkYamlWorkItems(filePath, content);
  }
  if (filePath.endsWith(".md")) {
    return chunkMarkdownFile(filePath, content);
  }
  return [];
}

/**
 * On first call for a given artifactDir, index all artifact files and source files.
 * Subsequent calls are fast (the index is already populated and kept up-to-date by the watcher).
 */
async function ensureIndexed(artifactDir: string, sourceDir: string): Promise<EmbeddingIndex> {
  const idx = getOrCreateEmbeddingIndex(artifactDir);

  // Use a simple sentinel: if the DB already has rows, assume it's bootstrapped.
  // Re-indexing on restart is handled chunk-by-hash (skips unchanged chunks).
  // We always do a full scan on first call so the watcher can take over after.
  const sentinelKey = `embedding_bootstrapped:${artifactDir}`;
  if ((embeddingIndexes as unknown as Map<string, unknown>).has(sentinelKey)) {
    return idx;
  }
  (embeddingIndexes as unknown as Map<string, unknown>).set(sentinelKey, true);

  // Make sure the watcher is active so subsequent changes are picked up
  artifactWatcher.watch(artifactDir);

  // Gather artifact files
  const artifactFiles = await globDir(artifactDir);
  const toIndex = artifactFiles.filter(
    (f) => f.endsWith(".md") || f.endsWith(".yaml") || f.endsWith(".yml")
  );

  // Gather source files
  const sourceFiles = existsSync(sourceDir)
    ? (await globDir(sourceDir)).filter(isSourceFile)
    : [];

  const allFiles = [...toIndex, ...sourceFiles];

  // Index in parallel batches of 8 to avoid memory spikes
  const BATCH = 8;
  for (let i = 0; i < allFiles.length; i += BATCH) {
    const batch = allFiles.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (filePath) => {
        const content = await readFileSafe(filePath);
        if (!content) return;
        const chunks = deriveChunks(filePath, content);
        if (chunks.length > 0) {
          await idx.indexFile(filePath, chunks);
        }
        fileToArtifactDir.set(path.resolve(filePath), artifactDir);
      })
    );
  }

  return idx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function statSafe(
  filePath: string
): Promise<{ size: number; mtime: Date } | null> {
  try {
    const s = await fs.stat(filePath);
    return { size: s.size, mtime: s.mtimeMs ? new Date(s.mtimeMs) : new Date() };
  } catch {
    return null;
  }
}

async function globDir(
  dir: string,
  options: { recursive?: boolean } = {}
): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (options.recursive !== false) await walk(full);
      } else {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

/** Determine language from file extension */
function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".sh": "Shell",
    ".bash": "Shell",
  };
  return map[ext] ?? null;
}

const EXPORT_PATTERNS: Record<string, RegExp> = {
  TypeScript: /^export\s+(function|class|interface|type|const|default)\s+(\w+)/m,
  JavaScript: /^export\s+(function|class|const|default)\s+(\w+)/m,
  Python: /^(def |class )(\w+)/m,
  Go: /^func ([A-Z]\w*)/m,
  Rust: /^pub\s+(fn|struct|trait|enum)\s+(\w+)/m,
  Shell: /^([a-z_]+)\s*\(\)/m,
};

/** Extract up to 5 named exports from a file's content */
function extractExports(content: string, language: string): string[] {
  const pattern = EXPORT_PATTERNS[language];
  if (!pattern) return [];

  const exports: string[] = [];
  const globalPattern = new RegExp(pattern.source, "gm");
  let match;
  while ((match = globalPattern.exec(content)) !== null && exports.length < 5) {
    // The name is in the last non-undefined capture group
    const name = match[match.length - 1];
    if (name && !exports.includes(name)) {
      exports.push(name);
    }
  }
  return exports;
}

/** Classify artifact type from path */
function classifyArtifact(filePath: string, artifactDir: string): string {
  const rel = path.relative(artifactDir, filePath);
  if (rel.startsWith("plan/work-items")) return "work-item";
  if (rel.startsWith("plan/modules")) return "module-spec";
  if (rel.startsWith("plan/")) return "plan";
  if (rel.startsWith("steering/")) return "steering";
  if (rel.startsWith("domains/")) return "domain";
  if (rel.startsWith("archive/incremental")) return "incremental-review";
  if (rel.startsWith("archive/cycles")) return "cycle-review";
  if (rel.startsWith("archive/")) return "archive";
  if (rel === "journal.md") return "journal";
  return "other";
}

/** Source files to exclude from the source code index */
const SOURCE_EXCLUDES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  ".nuxt",
  "coverage",
];

const TEST_FILE_PATTERN = /\.(test|spec)\.[^.]+$/;

function isSourceFile(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  if (parts.some((p) => SOURCE_EXCLUDES.includes(p))) return false;
  if (TEST_FILE_PATTERN.test(filePath)) return false;
  return detectLanguage(filePath) !== null;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * ideate_artifact_index — full artifact directory structure as JSON
 */
export async function artifactIndex(artifactDir: string): Promise<string> {
  const cacheKey = `artifact_index:${artifactDir}`;

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Ensure watcher covers this dir
  artifactWatcher.watch(artifactDir);

  const files = await globDir(artifactDir);
  const entries = await Promise.all(
    files.map(async (f) => {
      const s = await statSafe(f);
      registerDependency(cacheKey, f);
      return {
        path: path.relative(artifactDir, f),
        size: s?.size ?? 0,
        lastModified: s?.mtime?.toISOString() ?? null,
        type: classifyArtifact(f, artifactDir),
      };
    })
  );

  const result = JSON.stringify({ artifactDir, files: entries }, null, 2);
  cache.set(cacheKey, result);
  return result;
}

/**
 * ideate_domain_policies — domain policies, optionally filtered
 */
export async function domainPolicies(
  artifactDir: string,
  domain?: string
): Promise<string> {
  const cacheKey = `domain_policies:${artifactDir}:${domain ?? "*"}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  artifactWatcher.watch(artifactDir);

  const domainsDir = path.join(artifactDir, "domains");
  const lines: string[] = [];

  if (!existsSync(domainsDir)) {
    return `Note: No domains/ directory found in ${artifactDir}.`;
  }

  let domainDirs: string[];
  try {
    const entries = await fs.readdir(domainsDir, { withFileTypes: true });
    domainDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !domain || name === domain);
  } catch {
    return `Note: Could not read domains/ directory in ${artifactDir}.`;
  }

  if (domainDirs.length === 0) {
    return domain
      ? `Note: Domain "${domain}" not found in ${artifactDir}/domains/.`
      : `Note: No domain subdirectories found in ${artifactDir}/domains/.`;
  }

  for (const domainName of domainDirs.sort()) {
    const policiesPath = path.join(domainsDir, domainName, "policies.md");
    registerDependency(cacheKey, policiesPath);
    const content = await readFileSafe(policiesPath);
    if (content) {
      lines.push(`# Domain: ${domainName}`, "", content.trim(), "", "---", "");
    } else {
      lines.push(
        `# Domain: ${domainName}`,
        "",
        `Note: ${policiesPath} not found.`,
        "",
        "---",
        ""
      );
    }
  }

  const result = lines.join("\n");
  cache.set(cacheKey, result);
  return result;
}

/**
 * ideate_source_index — source code index table
 */
export async function sourceIndex(
  artifactDir: string,
  sourceDir: string,
  filterPath?: string
): Promise<string> {
  const cacheKey = `source_index:${artifactDir}:${sourceDir}:${filterPath ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  artifactWatcher.watch(artifactDir);

  const root = filterPath ? path.join(sourceDir, filterPath) : sourceDir;
  const allFiles = await globDir(root);
  const sourceFiles = allFiles.filter(isSourceFile);

  if (sourceFiles.length === 0) {
    return `Note: No source files found in ${root}.`;
  }

  const rows: string[] = [
    "| File | Language | Key Exports |",
    "|---|---|---|",
  ];

  for (const filePath of sourceFiles.sort()) {
    const lang = detectLanguage(filePath)!;
    registerDependency(cacheKey, filePath);
    const content = (await readFileSafe(filePath)) ?? "";
    const exports = extractExports(content, lang);
    if (exports.length === 0) continue; // skip files with no detectable exports
    const relPath = path.relative(sourceDir, filePath);
    rows.push(`| ${relPath} | ${lang} | ${exports.join(", ")} |`);
  }

  const result = rows.join("\n");
  cache.set(cacheKey, result);
  return result;
}

/**
 * ideate_get_context_package — the shared context package (5 sections)
 * Follows docs/context-package-spec.md exactly.
 */
export async function getContextPackage(
  artifactDir: string,
  reviewScope?: "full" | "differential",
  changedFiles?: string[]
): Promise<string> {
  const cacheKey = `context_package:${artifactDir}:${reviewScope ?? "default"}:${(changedFiles ?? []).join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  artifactWatcher.watch(artifactDir);

  const sections: string[] = [];
  let totalLines = 0;

  // Section 1: Architecture
  const archPath = path.join(artifactDir, "plan", "architecture.md");
  registerDependency(cacheKey, archPath);
  const archContent = await readFileSafe(archPath);
  let archSection: string;
  if (!archContent) {
    archSection = `Note: ${archPath} not found.`;
  } else {
    const archLines = archContent.split("\n");
    if (archLines.length <= 300) {
      archSection = archContent.trim();
    } else {
      // Include component map + interface contracts sections only
      archSection = extractSections(archContent, [
        "component",
        "interface",
        "contract",
        "module",
      ]);
      if (!archSection) {
        // Fallback: first 300 lines
        archSection =
          archLines.slice(0, 300).join("\n").trim() +
          "\n\n[Architecture truncated — see full file for details]";
      }
    }
  }
  sections.push("## Architecture", "", archSection);
  totalLines += archSection.split("\n").length + 2;

  // Section 2: Guiding Principles
  const principlesPath = path.join(
    artifactDir,
    "steering",
    "guiding-principles.md"
  );
  registerDependency(cacheKey, principlesPath);
  const principlesContent = await readFileSafe(principlesPath);
  const principlesSection = principlesContent?.trim() ?? `Note: ${principlesPath} not found.`;
  sections.push("", "## Guiding Principles", "", principlesSection);
  totalLines += principlesSection.split("\n").length + 3;

  // Section 3: Constraints
  const constraintsPath = path.join(artifactDir, "steering", "constraints.md");
  registerDependency(cacheKey, constraintsPath);
  const constraintsContent = await readFileSafe(constraintsPath);
  const constraintsSection = constraintsContent?.trim() ?? `Note: ${constraintsPath} not found.`;
  sections.push("", "## Constraints", "", constraintsSection);
  totalLines += constraintsSection.split("\n").length + 3;

  // Section 4: Source Code Index
  // Determine source dir from architecture.md or fall back to parent of artifactDir
  const sourceDir = await detectSourceDir(artifactDir);
  const srcIndexContent = await buildSourceCodeIndex(
    cacheKey,
    sourceDir,
    totalLines > 700 ? 3 : 5 // stricter if already large
  );
  sections.push("", "## Source Code Index", "", srcIndexContent);
  totalLines += srcIndexContent.split("\n").length + 3;

  // Apply over-limit stricter filtering
  if (totalLines > 1000) {
    // Re-extract architecture: component map only
    if (archContent) {
      const strictArch = extractSections(archContent, ["component", "module"]);
      if (strictArch) {
        sections[2] = strictArch;
      }
    }
  }

  // Section 5: Full Document Paths
  const pathsSection = [
    `Full architecture: ${archPath}`,
    `Full principles: ${principlesPath}`,
    `Full constraints: ${constraintsPath}`,
  ].join("\n");
  sections.push("", "## Full Document Paths", "", pathsSection);

  const result = sections.join("\n");
  cache.set(cacheKey, result);
  return result;
}

/** Extract heading sections whose titles match any of the given keywords */
function extractSections(content: string, keywords: string[]): string {
  const lines = content.split("\n");
  const kw = keywords.map((k) => k.toLowerCase());
  const result: string[] = [];
  let capturing = false;
  let depth = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const currentDepth = headingMatch[1].length;
      const title = headingMatch[2].toLowerCase();
      const matches = kw.some((k) => title.includes(k));
      if (matches) {
        capturing = true;
        depth = currentDepth;
        result.push(line);
      } else if (capturing && currentDepth <= depth) {
        // Stopped capturing when we hit a same-level or higher heading
        capturing = false;
      } else if (capturing) {
        result.push(line);
      }
    } else if (capturing) {
      result.push(line);
    }
  }

  return result.join("\n").trim();
}

async function detectSourceDir(artifactDir: string): Promise<string> {
  // Try to find source dir: parent of artifact dir, or check architecture.md for clues
  const parent = path.dirname(artifactDir);
  // If artifactDir is named "specs" or similar, source is the parent
  const base = path.basename(artifactDir);
  if (["specs", "artifacts", ".ideate"].includes(base)) {
    return parent;
  }
  return parent;
}

async function buildSourceCodeIndex(
  cacheKey: string,
  sourceDir: string,
  maxExportsPerFile: number
): Promise<string> {
  const allFiles = await globDir(sourceDir);
  const sourceFiles = allFiles.filter(isSourceFile);

  if (sourceFiles.length === 0) {
    return `Note: No source files detected in ${sourceDir}.`;
  }

  const rows: string[] = [
    "| File | Language | Key Exports |",
    "|---|---|---|",
  ];

  for (const filePath of sourceFiles.sort()) {
    const lang = detectLanguage(filePath)!;
    registerDependency(cacheKey, filePath);
    const content = (await readFileSafe(filePath)) ?? "";
    const pattern = EXPORT_PATTERNS[lang];
    if (!pattern) continue;
    const exports = extractExportsN(content, lang, maxExportsPerFile);
    if (exports.length === 0) continue;
    const relPath = path.relative(sourceDir, filePath);
    rows.push(`| ${relPath} | ${lang} | ${exports.join(", ")} |`);
  }

  return rows.join("\n");
}

function extractExportsN(
  content: string,
  language: string,
  n: number
): string[] {
  const pattern = EXPORT_PATTERNS[language];
  if (!pattern) return [];
  const exports: string[] = [];
  const globalPattern = new RegExp(pattern.source, "gm");
  let match;
  while ((match = globalPattern.exec(content)) !== null && exports.length < n) {
    const name = match[match.length - 1];
    if (name && !exports.includes(name)) {
      exports.push(name);
    }
  }
  return exports;
}

/**
 * ideate_get_work_item_context — work item spec + module + domain policies + research
 */
export async function getWorkItemContext(
  artifactDir: string,
  workItemId: string
): Promise<string> {
  const cacheKey = `work_item_context:${artifactDir}:${workItemId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  artifactWatcher.watch(artifactDir);

  const sections: string[] = [];

  // 1. Work item spec
  const workItemContent = await loadWorkItem(artifactDir, workItemId, cacheKey);
  sections.push("## Work Item Spec", "", workItemContent);

  // 2. Module spec (if referenced in work item)
  const moduleSpec = await loadRelatedModuleSpec(
    artifactDir,
    workItemContent,
    cacheKey
  );
  if (moduleSpec) {
    sections.push("", "## Module Spec", "", moduleSpec);
  }

  // 3. Domain policies relevant to the work item
  const relevantDomains = extractMentionedDomains(workItemContent);
  if (relevantDomains.length > 0) {
    for (const domain of relevantDomains) {
      const policiesPath = path.join(
        artifactDir,
        "domains",
        domain,
        "policies.md"
      );
      registerDependency(cacheKey, policiesPath);
      const content = await readFileSafe(policiesPath);
      if (content) {
        sections.push(
          "",
          `## Domain Policies: ${domain}`,
          "",
          content.trim()
        );
      }
    }
  } else {
    // Include all domain policies if no specific domain mentioned
    const allPolicies = await domainPolicies(artifactDir);
    if (!allPolicies.startsWith("Note:")) {
      sections.push("", "## Domain Policies", "", allPolicies);
    }
  }

  // 4. Research (from steering/research.md or steering/research/)
  const researchContent = await loadResearch(artifactDir, cacheKey);
  if (researchContent) {
    sections.push("", "## Research", "", researchContent);
  }

  const result = sections.join("\n");
  cache.set(cacheKey, result);
  return result;
}

async function loadWorkItem(
  artifactDir: string,
  workItemId: string,
  cacheKey: string
): Promise<string> {
  // Check work-items.yaml first
  const yamlPath = path.join(artifactDir, "plan", "work-items.yaml");
  registerDependency(cacheKey, yamlPath);
  const yamlContent = await readFileSafe(yamlPath);
  if (yamlContent) {
    const extracted = extractWorkItemFromYaml(yamlContent, workItemId);
    if (extracted) return extracted;
  }

  // Fall back to individual .md files
  const workItemsDir = path.join(artifactDir, "plan", "work-items");
  if (!existsSync(workItemsDir)) {
    return `Note: Work item "${workItemId}" not found — no plan/work-items.yaml or plan/work-items/ directory.`;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(workItemsDir);
  } catch {
    return `Note: Could not read plan/work-items/ directory.`;
  }

  const normalized = workItemId.toLowerCase().replace(/\s+/g, "-");
  const match = entries.find((e) => {
    const lower = e.toLowerCase();
    return lower.startsWith(normalized) || lower.includes(`-${normalized}`);
  });

  if (!match) {
    return `Note: Work item "${workItemId}" not found. Available: ${entries.filter((e) => e.endsWith(".md")).join(", ")}`;
  }

  const filePath = path.join(workItemsDir, match);
  registerDependency(cacheKey, filePath);
  const content = await readFileSafe(filePath);
  return content?.trim() ?? `Note: Could not read ${filePath}.`;
}

function extractWorkItemFromYaml(yaml: string, id: string): string | null {
  // Simple extraction: find the item by id field
  const idNorm = id.toLowerCase();
  const lines = yaml.split("\n");
  let inItem = false;
  let itemLines: string[] = [];
  let depth = 0;

  for (const line of lines) {
    if (line.match(/^\s*-\s+id:\s*["']?(\w+)["']?/) ) {
      const match = line.match(/id:\s*["']?([^"'\s]+)["']?/);
      if (match && match[1].toLowerCase() === idNorm) {
        inItem = true;
        itemLines = [line];
        depth = line.search(/\S/);
        continue;
      } else if (inItem) {
        // Hit a different item at the same or lower indent — stop
        const currDepth = line.search(/\S/);
        if (currDepth <= depth) break;
      }
    }
    if (inItem) {
      const currDepth = line.trim() === "" ? Infinity : line.search(/\S/);
      if (
        line.trim() !== "" &&
        currDepth <= depth &&
        line.trim().startsWith("-")
      ) {
        break;
      }
      itemLines.push(line);
    }
  }

  return itemLines.length > 1 ? `\`\`\`yaml\n${itemLines.join("\n")}\n\`\`\`` : null;
}

async function loadRelatedModuleSpec(
  artifactDir: string,
  workItemContent: string,
  cacheKey: string
): Promise<string | null> {
  const modulesDir = path.join(artifactDir, "plan", "modules");
  if (!existsSync(modulesDir)) return null;

  // Look for module mentions in work item
  const moduleMatch = workItemContent.match(/modules?\/?([a-z0-9-]+)\.md/i);
  if (!moduleMatch) return null;

  const modulePath = path.join(modulesDir, moduleMatch[1] + ".md");
  registerDependency(cacheKey, modulePath);
  const content = await readFileSafe(modulePath);
  return content?.trim() ?? null;
}

function extractMentionedDomains(content: string): string[] {
  const matches = content.match(/domains?\/([\w-]+)/gi) ?? [];
  return [
    ...new Set(
      matches.map((m) => m.replace(/^domains?\//i, "").toLowerCase())
    ),
  ];
}

async function loadResearch(
  artifactDir: string,
  cacheKey: string
): Promise<string | null> {
  // Try steering/research.md
  const researchFile = path.join(artifactDir, "steering", "research.md");
  registerDependency(cacheKey, researchFile);
  const content = await readFileSafe(researchFile);

  if (content) {
    const lines = content.split("\n");
    if (lines.length > 1000) {
      return (
        lines.slice(0, 100).join("\n").trim() +
        `\n\n[Research section truncated — ${lines.length} lines total. See full file: ${researchFile}]`
      );
    }
    return content.trim();
  }

  // Try steering/research/ directory
  const researchDir = path.join(artifactDir, "steering", "research");
  if (!existsSync(researchDir)) return null;

  const files = await globDir(researchDir);
  if (files.length === 0) return null;

  const combined: string[] = [];
  let totalLines = 0;
  for (const f of files.sort()) {
    registerDependency(cacheKey, f);
    const c = await readFileSafe(f);
    if (!c) continue;
    const fLines = c.split("\n");
    if (totalLines + fLines.length > 1000) {
      combined.push(
        `\n[Further research files omitted — see ${researchDir} for full content]`
      );
      break;
    }
    combined.push(`### ${path.basename(f)}`, "", c.trim(), "");
    totalLines += fLines.length;
  }

  return combined.length > 0 ? combined.join("\n") : null;
}

/**
 * ideate_artifact_query — keyword search across all artifacts
 */
export async function artifactQuery(
  artifactDir: string,
  query: string
): Promise<string> {
  // No caching for queries — results depend on query text and file contents
  // We do watch the dir so file-level cache can be used for file reads
  artifactWatcher.watch(artifactDir);

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) {
    return "Note: Query must contain at least one term longer than 2 characters.";
  }

  const files = await globDir(artifactDir);
  const mdFiles = files.filter((f) => f.endsWith(".md") || f.endsWith(".yaml") || f.endsWith(".yml"));

  interface Chunk {
    file: string;
    startLine: number;
    endLine: number;
    text: string;
    score: number;
  }

  const chunks: Chunk[] = [];

  for (const filePath of mdFiles) {
    const content = await readFileSafe(filePath);
    if (!content) continue;

    const lines = content.split("\n");
    const CHUNK_SIZE = 50;

    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      const chunkLines = lines.slice(i, i + CHUNK_SIZE);
      const chunkText = chunkLines.join("\n").toLowerCase();
      const score = terms.reduce((acc, term) => {
        const count = (chunkText.match(new RegExp(term, "g")) ?? []).length;
        return acc + count;
      }, 0);

      if (score > 0) {
        chunks.push({
          file: filePath,
          startLine: i + 1,
          endLine: Math.min(i + CHUNK_SIZE, lines.length),
          text: chunkLines.join("\n"),
          score,
        });
      }
    }
  }

  // Sort by score descending, take top 10
  chunks.sort((a, b) => b.score - a.score);
  const top = chunks.slice(0, 10);

  if (top.length === 0) {
    return `Note: No results found for query: "${query}"`;
  }

  const result: string[] = [
    `# Search Results for: "${query}"`,
    `Found ${chunks.length} matching chunks. Showing top ${top.length}:`,
    "",
  ];

  for (let i = 0; i < top.length; i++) {
    const chunk = top[i];
    const relPath = path.relative(artifactDir, chunk.file);
    result.push(
      `## Result ${i + 1}: ${relPath} (lines ${chunk.startLine}–${chunk.endLine})`,
      "",
      chunk.text,
      "",
      "---",
      ""
    );
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// ideate_artifact_semantic_search
// ---------------------------------------------------------------------------

export async function artifactSemanticSearch(args: {
  artifact_dir: string;
  source_dir: string;
  query: string;
  top_k: number;
  filter?: SearchFilter;
  requesting_agent?: string;
}): Promise<string> {
  const { artifact_dir, source_dir, query, top_k, filter, requesting_agent } = args;

  const idx = await ensureIndexed(artifact_dir, source_dir);
  const results = await semanticSearch(idx, query, top_k, filter);

  logQuery(artifact_dir, query, results, requesting_agent);

  if (results.length === 0) {
    return `Note: No semantic search results found for query: "${query}"`;
  }

  const lines: string[] = [
    `# Semantic Search Results for: "${query}"`,
    `Showing top ${results.length} result(s):`,
    "",
  ];

  for (let i = 0; i < results.length; i++) {
    const { chunk, semanticScore, bm25Score, finalScore } = results[i];
    const relPath = path.relative(artifact_dir, chunk.filePath);
    const citation = `${relPath}:${chunk.startLine}-${chunk.endLine}`;
    const section = chunk.sectionPath.length > 0 ? chunk.sectionPath.join(" > ") : "(top-level)";

    lines.push(
      `## [${finalScore.toFixed(3)}] ${citation} — ${section}`,
      `_semantic: ${semanticScore.toFixed(3)}, bm25: ${bm25Score.toFixed(3)}, type: ${chunk.artifactType}${chunk.domain ? `, domain: ${chunk.domain}` : ""}_`,
      "",
      chunk.content,
      "",
      "---",
      ""
    );
  }

  return lines.join("\n");
}
