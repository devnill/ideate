/**
 * diagnostics.test.ts — Regression tests for ideate_check_workspace
 *
 * Each test seeds a minimal workspace, exercises one integrity check,
 * and asserts the expected count in the structured report.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

import { createSchema } from "../schema.js";
import * as dbSchema from "../db.js";
import type { ToolContext } from "../types.js";
import { LocalAdapter } from "../adapters/local/index.js";
import { handleCheckWorkspace } from "../tools/diagnostics.js";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let ideateDir: string;
let db: Database.Database;
let ctx: ToolContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ideate-diagnostics-test-"));
  ideateDir = path.join(tmpDir, ".ideate");
  fs.mkdirSync(ideateDir, { recursive: true });

  const dbPath = path.join(tmpDir, "test.db");
  db = new Database(dbPath);
  createSchema(db);

  const drizzleDb = drizzle(db, { schema: dbSchema });
  ctx = {
    db,
    drizzleDb,
    ideateDir,
    adapter: new LocalAdapter({ db, drizzleDb, ideateDir }),
  };
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a node row directly into the nodes table */
function insertNode(
  id: string,
  type: string,
  filePath: string,
  status = "pending"
): void {
  db.prepare(`
    INSERT OR REPLACE INTO nodes (id, type, cycle_created, cycle_modified, content_hash, token_count, file_path, status)
    VALUES (?, ?, NULL, NULL, 'testhash', NULL, ?, ?)
  `).run(id, type, filePath, status);
}

/** Insert a finding extension row (node must already exist) */
function insertFindingRow(
  id: string,
  severity: string,
  workItem: string,
  addressedBy: string | null = null
): void {
  db.prepare(`
    INSERT OR REPLACE INTO findings (id, severity, work_item, verdict, cycle, reviewer, addressed_by)
    VALUES (?, ?, ?, 'pass', 1, 'test-reviewer', ?)
  `).run(id, severity, workItem, addressedBy);
}

/** Parse the JSON report returned by handleCheckWorkspace */
async function runCheck(): Promise<ReturnType<typeof JSON.parse>> {
  const result = await handleCheckWorkspace(ctx, {});
  return JSON.parse(result);
}

// ---------------------------------------------------------------------------
// 1. orphan_nodes
// ---------------------------------------------------------------------------

describe("ideate_check_workspace — orphan_nodes", () => {
  it("detects a node whose file_path no longer exists on disk", async () => {
    // Write a real YAML file, index it, then delete the file
    const yamlPath = path.join(ideateDir, "WI-001.yaml");
    fs.writeFileSync(yamlPath, "id: WI-001\ntype: work_item\n", "utf8");
    insertNode("WI-001", "work_item", yamlPath);

    // Delete the YAML — node still in DB
    fs.unlinkSync(yamlPath);

    const report = await runCheck();
    expect(report.checks.orphan_nodes.count).toBe(1);
    expect(report.checks.orphan_nodes.examples).toContain("WI-001");
  });

  it("does not flag a node whose file exists", async () => {
    const yamlPath = path.join(ideateDir, "WI-002.yaml");
    fs.writeFileSync(yamlPath, "id: WI-002\ntype: work_item\n", "utf8");
    insertNode("WI-002", "work_item", yamlPath);

    const report = await runCheck();
    expect(report.checks.orphan_nodes.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. unindexed_yaml
// ---------------------------------------------------------------------------

describe("ideate_check_workspace — unindexed_yaml", () => {
  it("detects a YAML file on disk with no index row", async () => {
    // Write a YAML file directly — skip indexing
    const yamlPath = path.join(ideateDir, "WI-003.yaml");
    fs.writeFileSync(yamlPath, "id: WI-003\ntype: work_item\n", "utf8");

    // No node row inserted — this file is unindexed
    const report = await runCheck();
    expect(report.checks.unindexed_yaml.count).toBe(1);
    expect(report.checks.unindexed_yaml.examples).toContain(path.relative(ideateDir, yamlPath));
  });

  it("does not flag a YAML file that is indexed", async () => {
    const yamlPath = path.join(ideateDir, "WI-004.yaml");
    fs.writeFileSync(yamlPath, "id: WI-004\ntype: work_item\n", "utf8");
    insertNode("WI-004", "work_item", yamlPath);

    const report = await runCheck();
    expect(report.checks.unindexed_yaml.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. dangling_edges
// ---------------------------------------------------------------------------

describe("ideate_check_workspace — dangling_edges", () => {
  it("detects an edge pointing at a non-existent target node", async () => {
    // Insert source node
    const yamlPath = path.join(ideateDir, "WI-010.yaml");
    fs.writeFileSync(yamlPath, "id: WI-010\ntype: work_item\n", "utf8");
    insertNode("WI-010", "work_item", yamlPath);

    // Insert edge pointing to non-existent target; disable FK temporarily so
    // the INSERT succeeds — this simulates a stale index entry.
    db.pragma("foreign_keys = OFF");
    db.prepare(`
      INSERT OR REPLACE INTO edges (source_id, target_id, edge_type, props)
      VALUES (?, ?, ?, NULL)
    `).run("WI-010", "WI-NONEXISTENT", "depends_on");
    db.pragma("foreign_keys = ON");

    const report = await runCheck();
    expect(report.checks.dangling_edges.count).toBe(1);
    expect(report.checks.dangling_edges.examples[0]).toMatchObject({
      source: "WI-010",
      target: "WI-NONEXISTENT",
      type: "depends_on",
    });
  });

  it("does not flag an edge where both nodes exist", async () => {
    const pathA = path.join(ideateDir, "WI-011.yaml");
    const pathB = path.join(ideateDir, "WI-012.yaml");
    fs.writeFileSync(pathA, "id: WI-011\ntype: work_item\n", "utf8");
    fs.writeFileSync(pathB, "id: WI-012\ntype: work_item\n", "utf8");
    insertNode("WI-011", "work_item", pathA);
    insertNode("WI-012", "work_item", pathB);

    db.prepare(`
      INSERT OR REPLACE INTO edges (source_id, target_id, edge_type, props)
      VALUES (?, ?, ?, NULL)
    `).run("WI-011", "WI-012", "depends_on");

    const report = await runCheck();
    expect(report.checks.dangling_edges.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. stale_addressed_by
// ---------------------------------------------------------------------------

describe("ideate_check_workspace — stale_addressed_by", () => {
  it("detects a finding addressed_by a non-existent work item", async () => {
    const findingPath = path.join(ideateDir, "F-001.yaml");
    fs.writeFileSync(findingPath, "id: F-001\ntype: finding\n", "utf8");
    insertNode("F-001", "finding", findingPath, "open");
    insertFindingRow("F-001", "significant", "WI-001", "WI-NONEXISTENT");

    const report = await runCheck();
    expect(report.checks.stale_addressed_by.count).toBe(1);
    expect(report.checks.stale_addressed_by.examples[0]).toMatchObject({
      finding: "F-001",
      work_item: "WI-NONEXISTENT",
    });
  });

  it("does not flag a finding addressed_by an existing work item", async () => {
    const wiPath = path.join(ideateDir, "WI-020.yaml");
    const findingPath = path.join(ideateDir, "F-002.yaml");
    fs.writeFileSync(wiPath, "id: WI-020\ntype: work_item\n", "utf8");
    fs.writeFileSync(findingPath, "id: F-002\ntype: finding\n", "utf8");
    insertNode("WI-020", "work_item", wiPath);
    insertNode("F-002", "finding", findingPath, "open");
    insertFindingRow("F-002", "minor", "WI-020", "WI-020");

    const report = await runCheck();
    expect(report.checks.stale_addressed_by.count).toBe(0);
  });

  it("does not flag a finding with null addressed_by", async () => {
    const findingPath = path.join(ideateDir, "F-003.yaml");
    fs.writeFileSync(findingPath, "id: F-003\ntype: finding\n", "utf8");
    insertNode("F-003", "finding", findingPath, "open");
    insertFindingRow("F-003", "minor", "WI-001", null);

    const report = await runCheck();
    expect(report.checks.stale_addressed_by.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Report shape
// ---------------------------------------------------------------------------

describe("ideate_check_workspace — report shape", () => {
  it("returns valid JSON with expected top-level keys", async () => {
    const report = await runCheck();
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("summary");
    expect(report).toHaveProperty("checks");
    expect(report.summary.total_checks).toBe(4);
    expect(typeof report.summary.passed).toBe("number");
    expect(typeof report.summary.failed).toBe("number");
    expect(report.summary.passed + report.summary.failed).toBe(4);
  });

  it("summary.passed is 4 and summary.failed is 0 for a clean workspace", async () => {
    const report = await runCheck();
    expect(report.summary.passed).toBe(4);
    expect(report.summary.failed).toBe(0);
  });
});
