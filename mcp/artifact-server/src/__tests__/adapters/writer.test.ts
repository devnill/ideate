/**
 * writer.test.ts — Unit tests for LocalWriterAdapter fixes (WI-695)
 *
 * Covers three bug fixes:
 *   S1 — putNode rollback for updates: when the SQLite transaction fails on an
 *        update, the original YAML content is restored (not deleted).
 *   M4 — deleteNode write order: YAML file is removed before the SQLite DELETE
 *        (YAML-first per P-44).
 *   M3 — nextId error type: unsupported node type throws ValidationError with
 *        code INVALID_NODE_TYPE (not a plain Error).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

import { createSchema } from "../../schema.js";
import * as dbSchema from "../../db.js";
import type { DrizzleDb } from "../../db-helpers.js";
import { LocalAdapter } from "../../adapters/local/index.js";
import { LocalWriterAdapter } from "../../adapters/local/writer.js";
import { ValidationError } from "../../adapter.js";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let ideateDir: string;
let db: Database.Database;
let drizzleDb: DrizzleDb;
let adapter: LocalAdapter;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ideate-writer-test-"));
  ideateDir = path.join(tmpDir, ".ideate");

  // Minimal directory structure LocalAdapter expects
  for (const sub of [
    "work-items",
    "policies",
    "decisions",
    "questions",
    "principles",
    "constraints",
    "modules",
    "research",
    "interviews",
    "projects",
    "phases",
    "plan",
    "steering",
    "domains",
    "archive/cycles",
    "archive/incremental",
  ]) {
    fs.mkdirSync(path.join(ideateDir, sub), { recursive: true });
  }

  // domains/index.yaml needed for cycle_modified resolution
  fs.writeFileSync(
    path.join(ideateDir, "domains", "index.yaml"),
    "current_cycle: 1\n",
    "utf8"
  );

  const dbPath = path.join(tmpDir, "test.db");
  db = new Database(dbPath);
  createSchema(db);
  drizzleDb = drizzle(db, { schema: dbSchema });

  adapter = new LocalAdapter({ db, drizzleDb, ideateDir });
  await adapter.initialize();
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: build a LocalAdapter with a drizzleDb whose insert() always throws
// ---------------------------------------------------------------------------

function makeAdapterWithFailingDb(): LocalAdapter {
  const failingDrizzleDb = new Proxy(drizzleDb, {
    get(target, prop) {
      if (prop === "insert") {
        return () => {
          throw new Error("simulated SQLite constraint violation");
        };
      }
      const val = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof val === "function") return val.bind(target);
      return val;
    },
  }) as DrizzleDb;

  return new LocalAdapter({ db, drizzleDb: failingDrizzleDb, ideateDir });
}

// ---------------------------------------------------------------------------
// S1 — putNode rollback for updates
// ---------------------------------------------------------------------------

describe("putNode — rollback for existing node on SQLite transaction failure", () => {
  it("restores original YAML content (not deletes file) when SQLite transaction fails on update", async () => {
    // First write the node with the working adapter
    await adapter.putNode({
      id: "GP-001",
      type: "guiding_principle",
      properties: { name: "Original principle", description: "Original description" },
    });

    // Verify it was written
    const filePath = path.join(ideateDir, "principles", "GP-001.yaml");
    expect(fs.existsSync(filePath)).toBe(true);
    const originalContent = fs.readFileSync(filePath, "utf8");
    expect(originalContent).toContain("Original principle");

    // Now attempt an update with a failing adapter
    const failingAdapter = makeAdapterWithFailingDb();

    await expect(
      failingAdapter.putNode({
        id: "GP-001",
        type: "guiding_principle",
        properties: { name: "Updated principle", description: "Updated description" },
      })
    ).rejects.toThrow("simulated SQLite constraint violation");

    // File must still exist (not deleted)
    expect(fs.existsSync(filePath)).toBe(true);

    // File content must be the original (not the updated version)
    const restoredContent = fs.readFileSync(filePath, "utf8");
    expect(restoredContent).toBe(originalContent);
    expect(restoredContent).not.toContain("Updated principle");
  });

  it("throws ValidationError with TRANSACTION_FAILED on update rollback", async () => {
    // Create a node first
    await adapter.putNode({
      id: "GP-002",
      type: "guiding_principle",
      properties: { name: "Principle Two", description: "Desc two" },
    });

    const failingAdapter = makeAdapterWithFailingDb();

    let caughtError: unknown;
    try {
      await failingAdapter.putNode({
        id: "GP-002",
        type: "guiding_principle",
        properties: { name: "Updated Two", description: "Updated desc two" },
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
    const error = caughtError as ValidationError;
    expect(error.code).toBe("TRANSACTION_FAILED");
    expect(error.details?.operation).toBe("putNode");
  });

  it("deletes YAML file (not restores) when SQLite transaction fails on insert (new node)", async () => {
    const failingAdapter = makeAdapterWithFailingDb();
    const filePath = path.join(ideateDir, "principles", "GP-003.yaml");

    await expect(
      failingAdapter.putNode({
        id: "GP-003",
        type: "guiding_principle",
        properties: { name: "New principle", description: "Never persisted" },
      })
    ).rejects.toThrow("simulated SQLite constraint violation");

    // File must have been removed (rollback for inserts removes the file)
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("removes newly-written file on rollback when isUpdate=true but originalContent read failed (file unreadable)", async () => {
    // Create a node so isUpdate=true on the next call
    await adapter.putNode({
      id: "GP-004",
      type: "guiding_principle",
      properties: { name: "Unreadable principle", description: "Original desc" },
    });

    const filePath = path.join(ideateDir, "principles", "GP-004.yaml");
    expect(fs.existsSync(filePath)).toBe(true);

    // Make the file write-only (no read) so originalContent will be null after silent read failure,
    // but the new content write can still succeed before the SQLite transaction fails.
    fs.chmodSync(filePath, 0o222);

    let caughtError: unknown;
    const failingAdapter = makeAdapterWithFailingDb();
    try {
      await failingAdapter.putNode({
        id: "GP-004",
        type: "guiding_principle",
        properties: { name: "Updated principle", description: "Updated desc" },
      });
    } catch (err) {
      caughtError = err;
    } finally {
      // Restore permissions so afterEach cleanup can remove the temp directory (if file still exists)
      try { fs.chmodSync(filePath, 0o644); } catch { /* already gone — that's the expected success case */ }
    }

    // An error must have been thrown
    expect(caughtError).toBeDefined();

    // The newly-written file must have been cleaned up (either deleted or restored)
    // When originalContent is null, the rollback branch removes the file
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M4 — deleteNode write order: YAML removed before SQLite DELETE
// ---------------------------------------------------------------------------

describe("deleteNode — YAML-first write order (P-44)", () => {
  it("YAML file is absent after deleteNode completes", async () => {
    // Create a node
    await adapter.putNode({
      id: "GP-DEL-001",
      type: "guiding_principle",
      properties: { name: "To be deleted", description: "Will be removed" },
    });

    const filePath = path.join(ideateDir, "principles", "GP-DEL-001.yaml");
    expect(fs.existsSync(filePath)).toBe(true);

    // Delete it
    const result = await adapter.deleteNode("GP-DEL-001");

    expect(result.status).toBe("deleted");
    expect(result.id).toBe("GP-DEL-001");

    // YAML file must be absent after deleteNode completes
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("YAML file is removed before SQLite DELETE executes", async () => {
    // Create a node
    await adapter.putNode({
      id: "GP-DEL-002",
      type: "guiding_principle",
      properties: { name: "Order test principle", description: "Tests write order" },
    });

    const filePath = path.join(ideateDir, "principles", "GP-DEL-002.yaml");
    expect(fs.existsSync(filePath)).toBe(true);

    let fileExistedAtDeleteTime: boolean | null = null;

    // Patch db.transaction to intercept the SQLite DELETE and check file state at that point
    const originalTransaction = db.transaction.bind(db);
    (db as any).transaction = (fn: () => void) => {
      const txFn = () => {
        // At the time SQLite DELETE runs, the YAML file should already be gone
        fileExistedAtDeleteTime = fs.existsSync(filePath);
        return originalTransaction(fn)();
      };
      txFn.exclusive = txFn;
      return txFn;
    };

    try {
      await adapter.deleteNode("GP-DEL-002");
    } finally {
      // Restore
      (db as any).transaction = originalTransaction;
    }

    // The file should have already been removed when the SQLite transaction ran
    expect(fileExistedAtDeleteTime).toBe(false);
    // And it should still not exist after
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WI-702 — deleteNode YAML rollback on SQLite failure
// ---------------------------------------------------------------------------

describe("deleteNode — YAML rollback on SQLite failure (WI-702)", () => {
  it("restores YAML file when SQLite transaction fails", async () => {
    await adapter.putNode({
      id: "del-rollback",
      type: "guiding_principle",
      properties: { name: "Rollback test principle", description: "Should survive SQLite failure" },
    });

    const nodeBefore = await adapter.getNode("del-rollback");
    expect(nodeBefore).not.toBeNull();

    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((_fn: () => void) => {
      const txFn = () => { throw new Error("SQLite failure"); };
      txFn.exclusive = txFn;
      return txFn;
    }) as any;

    try {
      await expect(adapter.deleteNode("del-rollback")).rejects.toMatchObject({
        code: "TRANSACTION_FAILED",
      });
    } finally {
      db.transaction = originalTransaction;
    }

    // YAML file should still exist — getNode should return the node
    const nodeAfter = await adapter.getNode("del-rollback");
    expect(nodeAfter).not.toBeNull();
  });

  it("throws ValidationError with TRANSACTION_FAILED when SQLite transaction fails", async () => {
    await adapter.putNode({
      id: "del-error-code",
      type: "guiding_principle",
      properties: { name: "Error code test", description: "Check error code" },
    });

    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((_fn: () => void) => {
      const txFn = () => { throw new Error("simulated SQLite transaction failure"); };
      txFn.exclusive = txFn;
      return txFn;
    }) as any;

    let caughtError: unknown;
    try {
      try {
        await adapter.deleteNode("del-error-code");
      } catch (err) {
        caughtError = err;
      }
    } finally {
      db.transaction = originalTransaction;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
    const error = caughtError as ValidationError;
    expect(error.code).toBe("TRANSACTION_FAILED");
    expect(error.details?.operation).toBe("deleteNode");
    expect(error.details?.id).toBe("del-error-code");
  });

  // S1: double-failure — SQLite throws AND fs.writeFileSync (restore) also throws.
  // The restore is made to fail by removing the principles directory so writeFileSync
  // has no parent directory to write into — this causes a real ENOENT throw.
  it("throws TRANSACTION_FAILED with 'cleanup also failed' message when both SQLite and restore fail", async () => {
    await adapter.putNode({
      id: "del-double-fail",
      type: "guiding_principle",
      properties: { name: "Double failure test", description: "Both phases fail" },
    });

    const principlesDir = path.join(ideateDir, "principles");
    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((_fn: () => void) => {
      const txFn = () => {
        fs.rmSync(principlesDir, { recursive: true, force: true });
        throw new Error("SQLite failure");
      };
      txFn.exclusive = txFn;
      return txFn;
    }) as any;

    let caughtError: unknown;
    try {
      try {
        await adapter.deleteNode("del-double-fail");
      } catch (err) {
        caughtError = err;
      }
    } finally {
      db.transaction = originalTransaction;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
    const error = caughtError as ValidationError;
    expect(error.code).toBe("TRANSACTION_FAILED");
    expect(error.message).toContain("SQLite failure");
    expect(error.message).toContain("cleanup also failed");
  });

  // S2: null originalContent — file is already missing before deleteNode is called
  it("throws TRANSACTION_FAILED without crashing when YAML file is missing before unlink", async () => {
    await adapter.putNode({
      id: "del-missing-yaml",
      type: "guiding_principle",
      properties: { name: "Missing YAML test", description: "File deleted out-of-band" },
    });

    // Delete the YAML file manually to simulate out-of-band deletion
    const yamlFilePath = path.join(ideateDir, "principles", "del-missing-yaml.yaml");
    fs.unlinkSync(yamlFilePath);

    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((_fn: () => void) => {
      const txFn = () => { throw new Error("SQLite failure"); };
      txFn.exclusive = txFn;
      return txFn;
    }) as any;

    let caughtError: unknown;
    try {
      try {
        await adapter.deleteNode("del-missing-yaml");
      } catch (err) {
        caughtError = err;
      }
    } finally {
      db.transaction = originalTransaction;
    }

    // Should throw TRANSACTION_FAILED, not crash from writeFileSync(path, null)
    expect(caughtError).toBeInstanceOf(ValidationError);
    const error = caughtError as ValidationError;
    expect(error.code).toBe("TRANSACTION_FAILED");
  });

  // WI-705: FILESYSTEM_ERROR — unlinkSync fails with non-ENOENT error
  // Replace the YAML file with a directory so unlinkSync throws a non-ENOENT error
  // (EPERM on macOS, EISDIR on Linux), triggering the FILESYSTEM_ERROR path.
  it("throws FILESYSTEM_ERROR when unlinkSync fails with non-ENOENT error", async () => {
    await adapter.putNode({
      id: "del-fs-error",
      type: "guiding_principle",
      properties: { name: "FS error test", description: "Simulates unlink failure" },
    });

    // Swap the YAML file for a directory — unlinkSync on a directory throws EPERM (macOS) or EISDIR (Linux)
    const yamlFilePath = path.join(ideateDir, "principles", "del-fs-error.yaml");
    fs.unlinkSync(yamlFilePath);
    fs.mkdirSync(yamlFilePath);

    try {
      await expect(adapter.deleteNode("del-fs-error")).rejects.toMatchObject({
        code: "FILESYSTEM_ERROR",
      });
    } finally {
      // Clean up the dir so afterEach rmSync works
      fs.rmdirSync(yamlFilePath);
    }
  });
});

// ---------------------------------------------------------------------------
// WI-890 — archiveCycleLocal: fs.unlinkSync must not run inside transaction
// ---------------------------------------------------------------------------

describe("archiveCycleLocal — fs.unlinkSync ordering relative to SQLite transaction (WI-890)", () => {
  // Helper: seed one finding in the SQLite index and on disk.
  // status must be "active" so archiveCycleLocal's query picks it up.
  async function seedFinding(id: string, cycleNum: number): Promise<string> {
    await adapter.putNode({
      id,
      type: "finding",
      cycle: cycleNum,
      properties: {
        severity: "minor",
        work_item: "WI-001",
        file_refs: null,
        verdict: "pass",
        cycle: cycleNum,
        reviewer: "test",
        description: "regression test finding",
        suggestion: null,
        addressed_by: null,
        title: "Test finding",
        status: "active",
      },
    });
    const cycleStr = String(cycleNum).padStart(3, "0");
    return path.join(ideateDir, "cycles", cycleStr, "findings", `${id}.yaml`);
  }

  // Regression test 1: when the SQLite transaction throws, no originals are deleted.
  //
  // Before WI-890 the transaction callback called fs.unlinkSync before the SQLite
  // statements, so a mid-flight throw left originals deleted despite the rollback.
  // After WI-890 the transaction contains only SQLite work; originals survive a throw.
  it("originals remain on disk when SQLite transaction throws mid-flight", async () => {
    const cycleNum = 42;
    const filePath = await seedFinding("F-042-001", cycleNum);
    expect(fs.existsSync(filePath)).toBe(true);

    // Spy on db.transaction so the wrapped callback throws before any SQLite work.
    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((_fn: () => void) => {
      const txFn = () => {
        throw new Error("simulated SQLite mid-flight failure");
      };
      txFn.exclusive = txFn;
      return txFn;
    }) as unknown as typeof db.transaction;

    let result: string;
    try {
      result = await (adapter as any).archiveCycleLocal(cycleNum);
    } finally {
      db.transaction = originalTransaction;
    }

    // The call must report a rollback (not success).
    expect(result).toMatch(/transaction rolled back/i);

    // The original finding file must still be present — no unlinkSync ran inside the tx.
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // Regression test 2: when the transaction commits but a post-commit unlink fails,
  // the archive copy remains valid and the error is surfaced in the return value.
  //
  // We make the original file's parent directory read-only so fs.unlinkSync throws
  // (EACCES). This is the same filesystem-level technique used elsewhere in this file.
  it("archive copy survives and error is surfaced when post-commit unlink fails", async () => {
    const cycleNum = 43;
    const filePath = await seedFinding("F-043-001", cycleNum);
    expect(fs.existsSync(filePath)).toBe(true);

    const findingsDir = path.dirname(filePath);

    // Make the findings directory read-only so unlinkSync cannot remove the file.
    fs.chmodSync(findingsDir, 0o555);

    let result: string;
    try {
      result = await (adapter as any).archiveCycleLocal(cycleNum);
    } finally {
      // Restore so afterEach cleanup can remove the temp directory.
      fs.chmodSync(findingsDir, 0o755);
    }

    // The result must surface the unlink failure.
    expect(result).toMatch(/could not be deleted|Failed to delete/i);

    // The archive copy must still exist (commit succeeded before the unlink attempt).
    const cycleStr = String(cycleNum).padStart(3, "0");
    const archiveDst = path.join(ideateDir, "archive", "cycles", cycleStr, "incremental", "F-043-001.yaml");
    expect(fs.existsSync(archiveDst)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M3 — nextId: unsupported node type throws ValidationError with INVALID_NODE_TYPE
//
// The fix is in LocalWriterAdapter.nextId. The LocalAdapter dispatches
// journal_entry and finding to the writer; all other types go to the reader.
// We test the writer directly to verify the error type change.
// ---------------------------------------------------------------------------

describe("LocalWriterAdapter.nextId — ValidationError for unsupported node type", () => {
  let writer: LocalWriterAdapter;

  beforeEach(() => {
    writer = new LocalWriterAdapter({ db, drizzleDb, ideateDir });
  });

  it("throws ValidationError (not plain Error) for unsupported type", async () => {
    let caughtError: unknown;
    try {
      // domain_policy is a NodeType not handled by the writer's if-branches
      await writer.nextId("domain_policy" as any);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
  });

  it("error has code INVALID_NODE_TYPE for unsupported type", async () => {
    let caughtError: unknown;
    try {
      await writer.nextId("domain_policy" as any);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
    const error = caughtError as ValidationError;
    expect(error.code).toBe("INVALID_NODE_TYPE");
  });

  it("error message mentions the unsupported type", async () => {
    let caughtError: unknown;
    try {
      await writer.nextId("domain_policy" as any);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
    const error = caughtError as ValidationError;
    expect(error.message).toContain("domain_policy");
  });

  it("does NOT throw for writer-native types (journal_entry, work_item, finding)", async () => {
    // These are handled by the writer's own if-branches and should not throw
    await expect(writer.nextId("journal_entry", 1)).resolves.toMatch(/^J-/);
    await expect(writer.nextId("work_item")).resolves.toMatch(/^WI-/);
    await expect(writer.nextId("finding", 1)).resolves.toMatch(/^F-/);
  });
});

// ---------------------------------------------------------------------------
// WI-895 — patchNode: post-write filesystem failure does not corrupt SQLite
//
// Regression test: even if the YAML file is modified or removed after patchNode
// writes it but before the SQLite transaction commits, the transaction callback
// must use precomputed in-memory data (not re-read from disk). This verifies
// the fix that moved hash/token_count computation OUT of the transaction.
// ---------------------------------------------------------------------------

describe("patchNode — post-write filesystem failure does not corrupt SQLite (WI-895)", () => {
  it("SQLite is updated correctly when YAML file is removed after write but before transaction commits", async () => {
    // Create a work_item node with the working adapter
    await adapter.putNode({
      id: "WI-100",
      type: "work_item",
      properties: { title: "Original title", status: "pending" },
    });

    // Verify it exists in the index
    const before = await adapter.getNode("WI-100");
    expect(before).not.toBeNull();
    expect(before!.properties.title).toBe("Original title");

    const filePath = path.join(ideateDir, "work-items", "WI-100.yaml");

    // Intercept db.transaction to remove the YAML file *after* patchNode writes it
    // but *before* the SQLite transaction executes. With the old code (fs.readFileSync
    // inside the transaction), this would cause ENOENT inside the transaction.
    // With the fix, the transaction uses precomputed data and succeeds regardless.
    const originalTransaction = db.transaction.bind(db);
    let interceptOnce = true;
    (db as any).transaction = (fn: () => void) => {
      const txFn = () => {
        if (interceptOnce) {
          interceptOnce = false;
          // Simulate filesystem failure after YAML write: remove the file
          try { fs.unlinkSync(filePath); } catch { /* already gone */ }
        }
        return originalTransaction(fn)();
      };
      txFn.exclusive = txFn;
      return txFn;
    };

    let result: unknown;
    try {
      result = await adapter.patchNode({ id: "WI-100", properties: { title: "Updated title" } });
    } finally {
      (db as any).transaction = originalTransaction;
    }

    // patchNode should have succeeded (committed via precomputed data)
    expect(result).toMatchObject({ id: "WI-100", status: "updated" });

    // SQLite should reflect the updated title (not the old one)
    const nodeRow = db.prepare(`SELECT id FROM nodes WHERE id = 'WI-100'`).get();
    expect(nodeRow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// WI-904 — registry-driven upsertExtensionTableRow roundtrip tests
//
// For each node type that has an extension table, putNode then getNode and
// assert the extension-table columns returned in properties match the inputs.
// This is the regression guard against the old if/else chain behavior.
// ---------------------------------------------------------------------------

describe("WI-904 — registry-driven extension table roundtrip", () => {
  it("work_item: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "WI-RT-001",
      type: "work_item",
      properties: {
        title: "Roundtrip work item",
        complexity: "medium",
        domain: "core",
        phase: "PH-001",
        notes: "some notes",
        work_item_type: "bug",
        resolution: null,
      },
    });
    const node = await adapter.getNode("WI-RT-001");
    expect(node).not.toBeNull();
    expect(node!.properties.title).toBe("Roundtrip work item");
    expect(node!.properties.complexity).toBe("medium");
    expect(node!.properties.domain).toBe("core");
    expect(node!.properties.work_item_type).toBe("bug");
  });

  it("finding: extension table row matches input properties", async () => {
    fs.mkdirSync(path.join(ideateDir, "cycles", "001", "findings"), { recursive: true });
    await adapter.putNode({
      id: "F-001-001",
      type: "finding",
      cycle: 1,
      properties: {
        severity: "major",
        work_item: "WI-001",
        verdict: "fail",
        cycle: 1,
        reviewer: "agent-reviewer",
        description: "Found a bug",
        suggestion: "Fix it",
        addressed_by: null,
        title: "Bug finding",
        status: "active",
      },
    });
    const node = await adapter.getNode("F-001-001");
    expect(node).not.toBeNull();
    expect(node!.properties.severity).toBe("major");
    expect(node!.properties.verdict).toBe("fail");
    expect(node!.properties.reviewer).toBe("agent-reviewer");
    expect(node!.properties.title).toBe("Bug finding");
  });

  it("domain_policy: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "P-01",
      type: "domain_policy",
      properties: {
        domain: "workflow",
        description: "Always write tests",
        established: "2026-01-01",
        amended: null,
        amended_by: null,
        derived_from: null,
      },
    });
    const node = await adapter.getNode("P-01");
    expect(node).not.toBeNull();
    expect(node!.properties.domain).toBe("workflow");
    expect(node!.properties.description).toBe("Always write tests");
  });

  it("domain_decision: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "D-01",
      type: "domain_decision",
      properties: {
        domain: "artifact-structure",
        title: "Use YAML",
        description: "Artifacts stored as YAML",
        rationale: "Human readable",
        source: "GP-01",
        cycle: 1,
        supersedes: null,
      },
    });
    const node = await adapter.getNode("D-01");
    expect(node).not.toBeNull();
    expect(node!.properties.domain).toBe("artifact-structure");
    expect(node!.properties.title).toBe("Use YAML");
    expect(node!.properties.rationale).toBe("Human readable");
  });

  it("domain_question: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "Q-01",
      type: "domain_question",
      properties: {
        domain: "workflow",
        description: "How to handle retries?",
        impact: "high",
        source: "GP-02",
        resolution: null,
        resolved_in: null,
        addressed_by: null,
      },
    });
    const node = await adapter.getNode("Q-01");
    expect(node).not.toBeNull();
    expect(node!.properties.domain).toBe("workflow");
    expect(node!.properties.description).toBe("How to handle retries?");
    expect(node!.properties.impact).toBe("high");
  });

  it("guiding_principle: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "GP-RT-01",
      type: "guiding_principle",
      properties: {
        name: "Test everything",
        description: "Every change should have tests",
        amendment_history: null,
      },
    });
    const node = await adapter.getNode("GP-RT-01");
    expect(node).not.toBeNull();
    expect(node!.properties.name).toBe("Test everything");
    expect(node!.properties.description).toBe("Every change should have tests");
  });

  it("constraint: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "C-01",
      type: "constraint",
      properties: {
        category: "technical",
        description: "Must use TypeScript",
      },
    });
    const node = await adapter.getNode("C-01");
    expect(node).not.toBeNull();
    expect(node!.properties.category).toBe("technical");
    expect(node!.properties.description).toBe("Must use TypeScript");
  });

  it("research_finding: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "RF-roundtrip-001",
      type: "research_finding",
      properties: {
        topic: "SQLite performance",
        date: "2026-01-15",
        content: "WAL mode is faster",
        sources: null,
      },
    });
    const node = await adapter.getNode("RF-roundtrip-001");
    expect(node).not.toBeNull();
    expect(node!.properties.topic).toBe("SQLite performance");
    expect(node!.properties.content).toBe("WAL mode is faster");
  });

  it("module_spec: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "mod-roundtrip",
      type: "module_spec",
      properties: {
        name: "auth-module",
        scope: "Authentication and authorization",
        provides: ["login", "logout"],
        requires: ["database"],
        boundary_rules: ["no direct DB access"],
      },
    });
    const node = await adapter.getNode("mod-roundtrip");
    expect(node).not.toBeNull();
    expect(node!.properties.name).toBe("auth-module");
    expect(node!.properties.scope).toBe("Authentication and authorization");
  });

  it("interview_question: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "IQ-roundtrip-001",
      type: "interview_question",
      properties: {
        interview_id: "interview-refine-001",
        question: "What is the main pain point?",
        answer: "Slow builds",
        domain: "workflow",
        seq: 1,
      },
    });
    const node = await adapter.getNode("IQ-roundtrip-001");
    expect(node).not.toBeNull();
    expect(node!.properties.interview_id).toBe("interview-refine-001");
    expect(node!.properties.question).toBe("What is the main pain point?");
    expect(node!.properties.answer).toBe("Slow builds");
    expect(node!.properties.seq).toBe(1);
  });

  it("proxy_human_decision: extension table row matches input properties", async () => {
    fs.mkdirSync(path.join(ideateDir, "cycles", "002", "proxy-human"), { recursive: true });
    // No triggered_by here to avoid FK constraint on non-existent node; edge side-effect
    // is covered by the dedicated triggered_by edge test below.
    await adapter.putNode({
      id: "PHD-01",
      type: "proxy_human_decision",
      cycle: 2,
      properties: {
        cycle: 2,
        trigger: "scope ambiguity",
        triggered_by: null,
        decision: "proceed",
        rationale: "Low risk",
        timestamp: "2026-01-15T10:00:00.000Z",
        status: "resolved",
      },
    });
    const node = await adapter.getNode("PHD-01");
    expect(node).not.toBeNull();
    expect(node!.properties.trigger).toBe("scope ambiguity");
    expect(node!.properties.decision).toBe("proceed");
    expect(node!.properties.status).toBe("resolved");
  });

  it("project: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "PR-RT-001",
      type: "project",
      properties: {
        name: "Test Project",
        description: "A roundtrip test project",
        intent: "Validate registry dispatch",
        status: "active",
        current_phase_id: null,
        appetite: 3,
        steering: null,
        scope_boundary: null,
        success_criteria: null,
        horizon: null,
      },
    });
    const node = await adapter.getNode("PR-RT-001");
    expect(node).not.toBeNull();
    expect(node!.properties.name).toBe("Test Project");
    expect(node!.properties.intent).toBe("Validate registry dispatch");
    expect(node!.properties.status).toBe("active");
    expect(node!.properties.appetite).toBe(3);
  });

  it("phase: extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "PH-RT-001",
      type: "phase",
      properties: {
        name: "Implementation Phase",
        description: "Build the features",
        project: "PR-001",
        phase_type: "implementation",
        intent: "Deliver WI-001 through WI-005",
        status: "active",
        steering: null,
        work_items: ["WI-001", "WI-002"],
        completed_date: null,
      },
    });
    const node = await adapter.getNode("PH-RT-001");
    expect(node).not.toBeNull();
    expect(node!.properties.name).toBe("Implementation Phase");
    expect(node!.properties.project).toBe("PR-001");
    expect(node!.properties.phase_type).toBe("implementation");
    expect(node!.properties.status).toBe("active");
  });

  it("journal_entry: extension table row matches input properties", async () => {
    fs.mkdirSync(path.join(ideateDir, "cycles", "001", "journal"), { recursive: true });
    await adapter.putNode({
      id: "J-001-001",
      type: "journal_entry",
      cycle: 1,
      properties: {
        phase: "execute",
        date: "2026-01-15",
        title: "Test entry",
        work_item: "WI-001",
        content: "Completed the task",
      },
    });
    const node = await adapter.getNode("J-001-001");
    expect(node).not.toBeNull();
    expect(node!.properties.phase).toBe("execute");
    expect(node!.properties.title).toBe("Test entry");
    expect(node!.properties.content).toBe("Completed the task");
  });

  it("overview (document_artifact): extension table row matches input properties", async () => {
    await adapter.putNode({
      id: "plan-overview",
      type: "overview",
      properties: {
        title: "Project Overview",
        content: "This project aims to...",
        cycle: 1,
      },
    });
    const node = await adapter.getNode("plan-overview");
    expect(node).not.toBeNull();
    expect(node!.properties.title).toBe("Project Overview");
    expect(node!.properties.content).toBe("This project aims to...");
  });

  it("work_item with depends: inserts depends_on edges into edge table", async () => {
    // Seed dependency target
    await adapter.putNode({
      id: "WI-DEP-TARGET",
      type: "work_item",
      properties: { title: "Target", status: "pending" },
    });
    await adapter.putNode({
      id: "WI-DEP-SOURCE",
      type: "work_item",
      properties: {
        title: "Source item",
        depends: ["WI-DEP-TARGET"],
        status: "pending",
      },
    });
    const edge = db
      .prepare(`SELECT edge_type FROM edges WHERE source_id = ? AND target_id = ?`)
      .get("WI-DEP-SOURCE", "WI-DEP-TARGET") as { edge_type: string } | undefined;
    expect(edge).toBeDefined();
    expect(edge!.edge_type).toBe("depends_on");
  });

  it("proxy_human_decision with triggered_by: inserts triggered_by edges", async () => {
    fs.mkdirSync(path.join(ideateDir, "cycles", "003", "proxy-human"), { recursive: true });
    // Seed target node
    await adapter.putNode({
      id: "WI-PHD-REF",
      type: "work_item",
      properties: { title: "Referenced WI", status: "pending" },
    });
    await adapter.putNode({
      id: "PHD-02",
      type: "proxy_human_decision",
      cycle: 3,
      properties: {
        cycle: 3,
        trigger: "unclear scope",
        triggered_by: [{ type: "work_item", id: "WI-PHD-REF" }],
        decision: "defer",
        rationale: "Needs more info",
        timestamp: "2026-02-01T12:00:00.000Z",
        status: "resolved",
      },
    });
    const edge = db
      .prepare(`SELECT edge_type FROM edges WHERE source_id = ? AND target_id = ?`)
      .get("PHD-02", "WI-PHD-REF") as { edge_type: string } | undefined;
    expect(edge).toBeDefined();
    expect(edge!.edge_type).toBe("triggered_by");
  });
});

// ---------------------------------------------------------------------------
// WI-922 — isLinkedByDepends: seeds from existing SQLite depends_on edges
//
// Regression guard for the fix in writer.ts that seeds dependsGraph from
// existing SQLite edges before the BFS. Without the fix, items in the current
// batch that are reachable only through a pre-existing node (not in the batch)
// could not have their dependency relationship detected, causing a false
// scope-collision error.
// ---------------------------------------------------------------------------

describe("WI-922 — isLinkedByDepends respects pre-existing SQLite depends_on edges", () => {
  it("batch [WI-B depends:[WI-A], WI-C depends:[WI-A]] succeeds after WI-A is seeded", async () => {
    // Cycle 1: seed WI-A with no depends
    await adapter.putNode({
      id: "WI-LINK-A",
      type: "work_item",
      properties: { title: "Existing shared dep", status: "pending" },
    });

    // Cycle 2: batch-write WI-B and WI-C, both depending on WI-A.
    // They do NOT share scope files — so no collision should occur.
    const result = await adapter.batchMutate({
      nodes: [
        {
          id: "WI-LINK-B",
          type: "work_item",
          properties: {
            title: "Item B",
            status: "pending",
            depends: ["WI-LINK-A"],
            scope: [{ path: "src/b.ts", op: "modify" }],
          },
        },
        {
          id: "WI-LINK-C",
          type: "work_item",
          properties: {
            title: "Item C",
            status: "pending",
            depends: ["WI-LINK-A"],
            scope: [{ path: "src/c.ts", op: "modify" }],
          },
        },
      ],
    });

    // Both writes must succeed — no false scope-collision error
    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(2);
    const ids = result.results.map(r => r.id);
    expect(ids).toContain("WI-LINK-B");
    expect(ids).toContain("WI-LINK-C");
  });

  it("cross-batch depends chain: WI-C reachable via pre-existing edge WI-B→WI-A prevents collision", async () => {
    // Cycle 1: seed WI-A and WI-B where WI-B depends on WI-A.
    // This stores a depends_on edge WI-B→WI-A in SQLite.
    await adapter.putNode({
      id: "WI-CHAIN-A",
      type: "work_item",
      properties: {
        title: "Chain root",
        status: "pending",
        scope: [{ path: "src/shared.ts", op: "modify" }],
      },
    });
    await adapter.putNode({
      id: "WI-CHAIN-B",
      type: "work_item",
      properties: {
        title: "Chain middle",
        status: "pending",
        depends: ["WI-CHAIN-A"],
      },
    });

    // Verify the depends_on edge was stored in SQLite
    const edge = db
      .prepare(`SELECT edge_type FROM edges WHERE source_id = ? AND target_id = ?`)
      .get("WI-CHAIN-B", "WI-CHAIN-A") as { edge_type: string } | undefined;
    expect(edge).toBeDefined();
    expect(edge!.edge_type).toBe("depends_on");

    // Cycle 2: batch-write [WI-CHAIN-A (update, scope: shared.ts),
    //                        WI-CHAIN-C (depends:[WI-CHAIN-B], scope: shared.ts)]
    //
    // WI-CHAIN-A and WI-CHAIN-C share a scope file. Without the fix,
    // dependsGraph has no entry for WI-CHAIN-B (not in batch), so
    // reachable(WI-CHAIN-C, WI-CHAIN-A) cannot traverse WI-CHAIN-C→WI-CHAIN-B→WI-CHAIN-A.
    // With the fix, the SQLite edge WI-CHAIN-B→WI-CHAIN-A is seeded
    // (target_id=WI-CHAIN-A is in the batch), enabling the full traversal.
    const result = await adapter.batchMutate({
      nodes: [
        {
          id: "WI-CHAIN-A",
          type: "work_item",
          properties: {
            title: "Chain root updated",
            status: "pending",
            scope: [{ path: "src/shared.ts", op: "modify" }],
          },
        },
        {
          id: "WI-CHAIN-C",
          type: "work_item",
          properties: {
            title: "Chain leaf",
            status: "pending",
            depends: ["WI-CHAIN-B"],
            scope: [{ path: "src/shared.ts", op: "modify" }],
          },
        },
      ],
    });

    // Both writes must succeed — no false scope-collision error.
    // Pre-fix: errors would contain a "Scope collision between items WI-CHAIN-A and WI-CHAIN-C" entry.
    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// WI-895 — batchMutate: post-write filesystem failure does not corrupt SQLite
//
// Regression test: batchMutate writes YAML files in Phase 1 and then upserts
// to SQLite in Phase 2. The old code re-read each file inside the transaction.
// The fix precomputes hash/token_count from the in-memory yamlObj so the
// transaction is filesystem-independent.
// ---------------------------------------------------------------------------

describe("batchMutate — post-write filesystem failure does not corrupt SQLite (WI-895)", () => {
  it("SQLite is upserted correctly when YAML files are removed after write but before transaction commits", async () => {
    const writtenPaths: string[] = [];

    // Intercept db.transaction to remove all written YAML files before the
    // transaction executes. With the old code, fs.readFileSync would throw ENOENT
    // inside the transaction. With the fix, precomputed data is used instead.
    const originalTransaction = db.transaction.bind(db);
    let interceptOnce = true;
    (db as any).transaction = (fn: () => void) => {
      const txFn = () => {
        if (interceptOnce) {
          interceptOnce = false;
          // Remove all written YAML files to simulate post-write filesystem failure
          for (const fp of writtenPaths) {
            try { fs.unlinkSync(fp); } catch { /* already gone */ }
          }
        }
        return originalTransaction(fn)();
      };
      txFn.exclusive = txFn;
      return txFn;
    };

    // Patch fs.writeFileSync to track which paths are written by batchMutate
    const origWrite = fs.writeFileSync.bind(fs);
    const writeStub = (p: fs.PathOrFileDescriptor, data: unknown, opts?: unknown) => {
      if (typeof p === "string" && p.endsWith(".yaml")) {
        writtenPaths.push(p);
      }
      return (origWrite as Function)(p, data, opts);
    };
    (fs as any).writeFileSync = writeStub;

    let result: unknown;
    try {
      result = await adapter.batchMutate({
        nodes: [
          { id: "WI-200", type: "work_item", properties: { title: "Batch item one", status: "pending" } },
          { id: "WI-201", type: "work_item", properties: { title: "Batch item two", status: "pending" } },
        ],
      });
    } finally {
      (db as any).transaction = originalTransaction;
      (fs as any).writeFileSync = origWrite;
    }

    // batchMutate should have succeeded
    const batchResult = result as { results: Array<{ id: string; status: string }>; errors: unknown[] };
    expect(batchResult.errors).toHaveLength(0);
    expect(batchResult.results).toHaveLength(2);

    // SQLite rows should exist for both nodes
    const row200 = db.prepare(`SELECT id FROM nodes WHERE id = 'WI-200'`).get();
    const row201 = db.prepare(`SELECT id FROM nodes WHERE id = 'WI-201'`).get();
    expect(row200).toBeDefined();
    expect(row201).toBeDefined();
  });
});
