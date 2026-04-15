/**
 * metrics.test.ts — Tests for handleEmitMetric and handleGetMetrics tools.
 *
 * handleGetMetrics tests use a hand-rolled mock StorageAdapter (no ctx.db,
 * no ctx.drizzleDb, no SQLite) to verify the adapter-delegated data path
 * required by RF-clean-interface-proposal §1 invariant 2 (WI-805 / Leak 7).
 *
 * handleEmitMetric tests use a minimal ctx (no adapter required — the handler
 * is a no-op that does not touch storage).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import type { StorageAdapter, Node, NodeType, QueryResult, NodeFilter, MetricsEventRow } from "../adapter.js";
import type { ToolContext } from "../types.js";
import { handleEmitMetric, handleGetMetrics } from "../tools/metrics.js";

// ---------------------------------------------------------------------------
// Mock adapter factory
//
// Builds a minimal StorageAdapter stub that supports queryNodes and getNodes.
// All other methods throw — any unexpected call is a test failure.
// ---------------------------------------------------------------------------

type MockNodes = Map<string, Node>;

function makeNode(
  id: string,
  eventName: string,
  payload: Record<string, unknown>,
  options: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    outcome?: string;
    findingCount?: number;
    findingSeverities?: string;
    firstPassAccepted?: number | null;
    reworkCount?: number;
    cycleCreated?: number | null;
    timestamp?: string;
  } = {}
): Node {
  return {
    id,
    type: "metrics_event" as NodeType,
    status: null,
    cycle_created: options.cycleCreated ?? null,
    cycle_modified: null,
    content_hash: "test-hash",
    token_count: null,
    properties: {
      event_name: eventName,
      timestamp: options.timestamp ?? "2026-01-01T00:00:00Z",
      payload: JSON.stringify(payload),
      input_tokens: options.inputTokens ?? null,
      output_tokens: options.outputTokens ?? null,
      cache_read_tokens: options.cacheReadTokens ?? null,
      cache_write_tokens: null,
      outcome: options.outcome ?? null,
      finding_count: options.findingCount ?? null,
      finding_severities: options.findingSeverities ?? null,
      first_pass_accepted: options.firstPassAccepted ?? null,
      rework_count: options.reworkCount ?? null,
      work_item_total_tokens: null,
      cycle_total_tokens: null,
      cycle_total_cost_estimate: null,
      convergence_cycles: null,
      context_artifact_ids: null,
    },
  };
}

function buildMockAdapter(nodes: MockNodes): {
  adapter: StorageAdapter;
  getMetricsEventsCalls: Array<NodeFilter | undefined>;
  // Legacy call trackers retained for backward-compatibility with existing tests
  // that verify no unexpected queryNodes/getNodes calls are made.
  queryNodesCalls: Array<{ filter: unknown; limit: number; offset: number }>;
  getNodesCalls: Array<string[]>;
} {
  const getMetricsEventsCalls: Array<NodeFilter | undefined> = [];
  const queryNodesCalls: Array<{ filter: unknown; limit: number; offset: number }> = [];
  const getNodesCalls: Array<string[]> = [];

  const notImplemented = (name: string) => () => {
    throw new Error(`MockAdapter.${name} was called unexpectedly`);
  };

  /**
   * Convert a Node from the mock map to a MetricsEventRow.
   * The Node's properties already match MetricsEventProperties shape.
   */
  function nodeToMetricsEventRow(node: Node): MetricsEventRow {
    const p = node.properties;
    function num(v: unknown): number | null {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return v;
      const n = Number(v);
      return isNaN(n) ? null : n;
    }
    function str(v: unknown): string | null {
      if (v === null || v === undefined) return null;
      return String(v);
    }
    return {
      node: {
        id: node.id,
        type: node.type,
        status: node.status,
        cycle_created: node.cycle_created,
        cycle_modified: node.cycle_modified,
        content_hash: node.content_hash,
        token_count: node.token_count,
      },
      properties: {
        event_name: str(p.event_name),
        timestamp: str(p.timestamp),
        payload: str(p.payload),
        input_tokens: num(p.input_tokens),
        output_tokens: num(p.output_tokens),
        cache_read_tokens: num(p.cache_read_tokens),
        cache_write_tokens: num(p.cache_write_tokens),
        outcome: str(p.outcome),
        finding_count: num(p.finding_count),
        finding_severities: str(p.finding_severities),
        first_pass_accepted: num(p.first_pass_accepted),
        rework_count: num(p.rework_count),
        work_item_total_tokens: num(p.work_item_total_tokens),
        cycle_total_tokens: num(p.cycle_total_tokens),
        cycle_total_cost_estimate: str(p.cycle_total_cost_estimate),
        convergence_cycles: num(p.convergence_cycles),
        context_artifact_ids: str(p.context_artifact_ids),
      },
    };
  }

  const adapter: StorageAdapter = {
    async getMetricsEvents(filter?: NodeFilter): Promise<MetricsEventRow[]> {
      getMetricsEventsCalls.push(filter);
      let results = Array.from(nodes.values())
        .filter((n) => n.type === "metrics_event")
        .map(nodeToMetricsEventRow);

      // Apply filters matching LocalAdapter behavior
      if (filter) {
        if (filter.cycle !== undefined && filter.cycle !== null) {
          results = results.filter((r) => r.node.cycle_created === filter.cycle);
        }
        if (filter.agent_type !== undefined) {
          results = results.filter((r) => {
            if (!r.properties.payload) return false;
            try {
              const p = JSON.parse(r.properties.payload) as Record<string, unknown>;
              return p.agent_type === filter.agent_type;
            } catch { return false; }
          });
        }
        if (filter.work_item !== undefined) {
          results = results.filter((r) => {
            if (!r.properties.payload) return false;
            try {
              const p = JSON.parse(r.properties.payload) as Record<string, unknown>;
              return p.work_item === filter.work_item;
            } catch { return false; }
          });
        }
        if (filter.phase !== undefined) {
          results = results.filter((r) => {
            if (!r.properties.payload) return false;
            try {
              const p = JSON.parse(r.properties.payload) as Record<string, unknown>;
              return p.phase === filter.phase;
            } catch { return false; }
          });
        }
      }

      // Sort: timestamp ASC, id ASC
      results.sort((a, b) => {
        const tA = a.properties.timestamp ?? "";
        const tB = b.properties.timestamp ?? "";
        if (tA < tB) return -1;
        if (tA > tB) return 1;
        return a.node.id.localeCompare(b.node.id);
      });

      return results;
    },

    async queryNodes(filter, limit, offset): Promise<QueryResult> {
      queryNodesCalls.push({ filter, limit, offset });
      const matching = Array.from(nodes.values()).filter(
        (n) => !filter.type || n.type === filter.type
      );
      return {
        nodes: matching.map((n) => ({ node: n, summary: n.id })),
        total_count: matching.length,
      };
    },

    async getNodes(ids: string[]): Promise<Map<string, Node>> {
      getNodesCalls.push(ids);
      const result = new Map<string, Node>();
      for (const id of ids) {
        const n = nodes.get(id);
        if (n) result.set(id, n);
      }
      return result;
    },

    getNode: notImplemented("getNode") as StorageAdapter["getNode"],
    readNodeContent: notImplemented("readNodeContent") as StorageAdapter["readNodeContent"],
    putNode: notImplemented("putNode") as StorageAdapter["putNode"],
    patchNode: notImplemented("patchNode") as StorageAdapter["patchNode"],
    deleteNode: notImplemented("deleteNode") as StorageAdapter["deleteNode"],
    putEdge: notImplemented("putEdge") as StorageAdapter["putEdge"],
    removeEdges: notImplemented("removeEdges") as StorageAdapter["removeEdges"],
    getEdges: notImplemented("getEdges") as StorageAdapter["getEdges"],
    traverse: notImplemented("traverse") as StorageAdapter["traverse"],
    queryGraph: notImplemented("queryGraph") as StorageAdapter["queryGraph"],
    nextId: notImplemented("nextId") as StorageAdapter["nextId"],
    batchMutate: notImplemented("batchMutate") as StorageAdapter["batchMutate"],
    countNodes: notImplemented("countNodes") as StorageAdapter["countNodes"],
    getDomainState: notImplemented("getDomainState") as StorageAdapter["getDomainState"],
    getConvergenceData: notImplemented("getConvergenceData") as StorageAdapter["getConvergenceData"],
    initialize: notImplemented("initialize") as StorageAdapter["initialize"],
    shutdown: notImplemented("shutdown") as StorageAdapter["shutdown"],
    archiveCycle: notImplemented("archiveCycle") as StorageAdapter["archiveCycle"],
    appendJournalEntry: notImplemented("appendJournalEntry") as StorageAdapter["appendJournalEntry"],
    indexFiles: async (_paths: string[]) => { /* no-op stub */ },
    removeFiles: async (_paths: string[]) => { /* no-op stub */ },
  };

  return { adapter, getMetricsEventsCalls, queryNodesCalls, getNodesCalls };
}

// ---------------------------------------------------------------------------
// ctx factory — adapter-only, no ctx.db
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ideate-metrics-test-"));
});

function makeCtx(adapter: StorageAdapter): ToolContext {
  // ctx.db is intentionally omitted — handleGetMetrics must not access it.
  // TypeScript requires the field, so we cast undefined through unknown.
  return {
    db: undefined as unknown as ToolContext["db"],
    drizzleDb: undefined as unknown as ToolContext["drizzleDb"],
    ideateDir: tmpDir,
    adapter,
  };
}

// ---------------------------------------------------------------------------
// handleEmitMetric tests
// (No adapter required — handler is a pure no-op.)
// ---------------------------------------------------------------------------

const minimalCtx: ToolContext = {
  db: undefined as unknown as ToolContext["db"],
  drizzleDb: undefined as unknown as ToolContext["drizzleDb"],
  ideateDir: os.tmpdir(),
};

describe("handleEmitMetric", () => {
  describe("required parameters", () => {
    it("throws when payload is missing", async () => {
      await expect(
        handleEmitMetric(minimalCtx, {})
      ).rejects.toThrow("Missing required parameter: payload");
    });

    it("throws when payload is null", async () => {
      await expect(
        handleEmitMetric(minimalCtx, { payload: null })
      ).rejects.toThrow("Missing required parameter: payload");
    });
  });

  describe("no-op emission (soft-deprecated)", () => {
    it("returns deprecation message and creates no file under metrics/", async () => {
      const payload = { event_name: "code-reviewer", input_tokens: 100 };
      const result = await handleEmitMetric(minimalCtx, { payload });

      expect(result).toBe("Metric emission deprecated — event not recorded.");

      // No YAML file should be written
      const metricsDir = path.join(os.tmpdir(), "metrics");
      const files = fs.existsSync(metricsDir)
        ? fs.readdirSync(metricsDir).filter((f) => f.endsWith(".yaml"))
        : [];
      expect(files).toHaveLength(0);
    });

    it("returns deprecation message for any payload", async () => {
      const result = await handleEmitMetric(minimalCtx, {
        payload: { event_name: "architect", input_tokens: 1000, cycle: 3 },
      });
      expect(result).toBe("Metric emission deprecated — event not recorded.");
    });

    it("does not write metrics.jsonl in tmpDir", async () => {
      // Use the per-test tmpDir (isolated from other tests) to verify no file is created.
      const isolatedCtx: ToolContext = {
        db: undefined as unknown as ToolContext["db"],
        drizzleDb: undefined as unknown as ToolContext["drizzleDb"],
        ideateDir: tmpDir,
      };
      await handleEmitMetric(isolatedCtx, { payload: { event_name: "test" } });
      const jsonlPath = path.join(tmpDir, "metrics.jsonl");
      expect(fs.existsSync(jsonlPath)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// handleGetMetrics tests — all use mock adapter, no ctx.db
// ---------------------------------------------------------------------------

describe("handleGetMetrics", () => {
  describe("adapter requirement", () => {
    it("throws if ctx.adapter is not set", async () => {
      const ctx: ToolContext = {
        db: undefined as unknown as ToolContext["db"],
        drizzleDb: undefined as unknown as ToolContext["drizzleDb"],
        ideateDir: tmpDir,
      };
      await expect(handleGetMetrics(ctx, {})).rejects.toThrow(
        "metrics.ts: ToolContext.adapter is required"
      );
    });

    it("routes data through adapter — getMetricsEvents is called (single O(1) call)", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "code-reviewer", { agent_type: "code-reviewer" }, { inputTokens: 100 })],
      ]);
      const { adapter, getMetricsEventsCalls, queryNodesCalls, getNodesCalls } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      await handleGetMetrics(ctx, { scope: "agent" });

      // Exactly one adapter call regardless of result count (eliminates N+1)
      expect(getMetricsEventsCalls).toHaveLength(1);
      // queryNodes and getNodes must NOT be called by handleGetMetrics
      expect(queryNodesCalls).toHaveLength(0);
      expect(getNodesCalls).toHaveLength(0);
    });
  });

  describe("empty result", () => {
    it("returns empty tables when no metrics exist", async () => {
      const { adapter } = buildMockAdapter(new Map());
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, {});
      expect(result).toContain("No agent metrics data found");
      expect(result).toContain("No work item metrics data found");
      expect(result).toContain("No cycle metrics data found");
      expect(result).toContain("**Total events**: 0");
    });
  });

  describe("agent scope aggregation", () => {
    it("aggregates metrics by agent type", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode("m1", "code-reviewer", { agent_type: "code-reviewer", work_item: "WI-1" }, { inputTokens: 1000, outputTokens: 500 }),
        ],
        [
          "m2",
          makeNode("m2", "code-reviewer", { agent_type: "code-reviewer", work_item: "WI-2" }, { inputTokens: 2000, outputTokens: 800 }),
        ],
        [
          "m3",
          makeNode("m3", "architect", { agent_type: "architect", work_item: "WI-3" }, { inputTokens: 5000, outputTokens: 2000 }),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "agent" });

      expect(result).not.toContain("No agent metrics data found");
      expect(result).toContain("code-reviewer");
      expect(result).toContain("architect");
      expect(result).toContain("**Total events**: 3");
      // code-reviewer has 2 events: total input = 1000 + 2000 = 3000
      expect(result).toContain("3000");
    });

    it("calculates average tokens correctly", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "test-agent", {}, { inputTokens: 100, outputTokens: 50 })],
        ["m2", makeNode("m2", "test-agent", {}, { inputTokens: 300, outputTokens: 150 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "agent" });

      // Avg input: (100 + 300) / 2 = 200; avg output: (50 + 150) / 2 = 100
      expect(result).toContain("200"); // avg input
      expect(result).toContain("100"); // avg output
    });

    it("tracks finding severities by agent", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode("m1", "reviewer", {}, {
            findingCount: 3,
            findingSeverities: '{"critical":1,"significant":1,"minor":1}',
          }),
        ],
        [
          "m2",
          makeNode("m2", "reviewer", {}, {
            findingCount: 2,
            findingSeverities: '{"critical":0,"significant":2,"minor":0}',
          }),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "agent" });
      // Total: critical:1, significant:3, minor:1
      expect(result).toContain("1/3/1");
    });

    it("tracks outcomes by agent", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "worker", {}, { outcome: "pass" })],
        ["m2", makeNode("m2", "worker", {}, { outcome: "pass" })],
        ["m3", makeNode("m3", "worker", {}, { outcome: "rework" })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "agent" });
      expect(result).toContain("pass: 2");
      expect(result).toContain("rework: 1");
    });

    it("uses agent_type from payload when present", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode(
            "m1",
            "some-event",
            { agent_type: "domain-curator" },
            { inputTokens: 500 }
          ),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "agent" });
      expect(result).toContain("domain-curator");
    });
  });

  describe("work_item scope aggregation", () => {
    it("aggregates metrics by work item", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode("m1", "agent", { work_item: "WI-100" }, { inputTokens: 1000, outputTokens: 500 }),
        ],
        [
          "m2",
          makeNode("m2", "agent", { work_item: "WI-100" }, { inputTokens: 500, outputTokens: 300 }),
        ],
        [
          "m3",
          makeNode("m3", "agent", { work_item: "WI-200" }, { inputTokens: 2000, outputTokens: 1000 }),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "work_item" });

      expect(result).not.toContain("No work item metrics data found");
      expect(result).toContain("WI-100");
      expect(result).toContain("WI-200");
    });

    it("tracks first pass accepted status", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode("m1", "agent", { work_item: "WI-001" }, { firstPassAccepted: 1 }),
        ],
        [
          "m2",
          makeNode("m2", "agent", { work_item: "WI-002" }, { firstPassAccepted: 0 }),
        ],
        [
          "m3",
          makeNode("m3", "agent", { work_item: "WI-003" }, { firstPassAccepted: null }),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "work_item" });

      expect(result).toContain("WI-001");
      expect(result).toContain("Yes"); // first_pass_accepted = true
      expect(result).toContain("WI-002");
      expect(result).toContain("No"); // first_pass_accepted = false
    });

    it("sums rework counts", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode("m1", "agent", { work_item: "WI-010" }, { reworkCount: 2 }),
        ],
        [
          "m2",
          makeNode("m2", "agent", { work_item: "WI-010" }, { reworkCount: 1 }),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "work_item" });
      // Total rework: 3
      expect(result).toContain("3");
    });
  });

  describe("cycle scope aggregation", () => {
    it("aggregates metrics by cycle", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode("m1", "agent", { work_item: "WI-1" }, { cycleCreated: 5 }),
        ],
        [
          "m2",
          makeNode("m2", "agent", { work_item: "WI-2" }, { cycleCreated: 5 }),
        ],
        [
          "m3",
          makeNode("m3", "agent", { work_item: "WI-3" }, { cycleCreated: 6 }),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "cycle" });

      expect(result).not.toContain("No cycle metrics data found");
      expect(result).toContain("| 5 |");
      expect(result).toContain("| 6 |");
    });

    it("tracks finding counts by cycle", async () => {
      const nodes: MockNodes = new Map([
        [
          "m1",
          makeNode("m1", "reviewer", {}, {
            cycleCreated: 10,
            findingSeverities: '{"critical":0,"significant":2,"minor":1}',
          }),
        ],
        [
          "m2",
          makeNode("m2", "reviewer", {}, {
            cycleCreated: 10,
            findingSeverities: '{"critical":1,"significant":0,"minor":3}',
          }),
        ],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "cycle" });
      // Total: critical:1, significant:2, minor:4
      expect(result).toContain("1/2/4");
    });
  });

  describe("filtering (TypeScript-side)", () => {
    it("filters by cycle via node.cycle_created", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", {}, { cycleCreated: 5 })],
        ["m2", makeNode("m2", "agent", {}, { cycleCreated: 5 })],
        ["m3", makeNode("m3", "agent", {}, { cycleCreated: 6 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { filter: { cycle: 5 } });

      expect(result).toContain("Filters**: cycle: 5");
      expect(result).toContain("**Total events**: 2");
    });

    it("filters by agent_type via payload JSON field", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "event", { agent_type: "code-reviewer" }, {})],
        ["m2", makeNode("m2", "event", { agent_type: "code-reviewer" }, {})],
        ["m3", makeNode("m3", "event", { agent_type: "architect" }, {})],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { filter: { agent_type: "code-reviewer" } });

      expect(result).toContain("Filters**: agent_type: code-reviewer");
      expect(result).toContain("**Total events**: 2");
    });

    it("filters by work_item using exact match on payload", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", { work_item: "WI-100" }, {})],
        ["m2", makeNode("m2", "agent", { work_item: "WI-100" }, {})],
        ["m3", makeNode("m3", "agent", { work_item: "WI-200" }, {})],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { filter: { work_item: "WI-100" } });

      expect(result).toContain("Filters**: work_item: WI-100");
      expect(result).toContain("**Total events**: 2");
    });

    it("work_item filter does not match prefix substrings (WI-1 must not match WI-10 or WI-100)", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", { work_item: "WI-1" }, {})],
        ["m2", makeNode("m2", "agent", { work_item: "WI-10" }, {})],
        ["m3", makeNode("m3", "agent", { work_item: "WI-100" }, {})],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { filter: { work_item: "WI-1" } });

      expect(result).toContain("Filters**: work_item: WI-1");
      expect(result).toContain("**Total events**: 1");
    });

    it("filters by phase via payload JSON field", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", { phase: "execute" }, {})],
        ["m2", makeNode("m2", "agent", { phase: "execute" }, {})],
        ["m3", makeNode("m3", "agent", { phase: "review" }, {})],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { filter: { phase: "execute" } });

      expect(result).toContain("Filters**: phase: execute");
      expect(result).toContain("**Total events**: 2");
    });

    it("combines multiple filters", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "event", { agent_type: "code-reviewer", work_item: "WI-1" }, { cycleCreated: 5 })],
        ["m2", makeNode("m2", "event", { agent_type: "code-reviewer", work_item: "WI-2" }, { cycleCreated: 5 })],
        ["m3", makeNode("m3", "event", { agent_type: "architect", work_item: "WI-3" }, { cycleCreated: 5 })],
        ["m4", makeNode("m4", "event", { agent_type: "code-reviewer", work_item: "WI-4" }, { cycleCreated: 6 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, {
        filter: { cycle: 5, agent_type: "code-reviewer" },
      });

      expect(result).toContain("Filters**: cycle: 5, agent_type: code-reviewer");
      expect(result).toContain("**Total events**: 2");
    });

    // GA-S3: Three-dimensional filter combinations (a) cycle + agent_type + phase
    it("(3D-a) cycle + agent_type + phase — only rows matching all three pass", async () => {
      // Dataset: rows matching all/some/none of the three filters
      const nodes: MockNodes = new Map([
        // Matches all three: cycle=7, agent_type="reviewer", phase="review"
        ["m1", makeNode("m1", "e", { agent_type: "reviewer", phase: "review" }, { cycleCreated: 7 })],
        // Matches cycle + agent_type but NOT phase
        ["m2", makeNode("m2", "e", { agent_type: "reviewer", phase: "execute" }, { cycleCreated: 7 })],
        // Matches cycle + phase but NOT agent_type
        ["m3", makeNode("m3", "e", { agent_type: "architect", phase: "review" }, { cycleCreated: 7 })],
        // Matches agent_type + phase but NOT cycle
        ["m4", makeNode("m4", "e", { agent_type: "reviewer", phase: "review" }, { cycleCreated: 8 })],
        // Matches none
        ["m5", makeNode("m5", "e", { agent_type: "worker", phase: "execute" }, { cycleCreated: 6 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, {
        filter: { cycle: 7, agent_type: "reviewer", phase: "review" },
      });

      expect(result).toContain("Filters**: cycle: 7, agent_type: reviewer, phase: review");
      // Only m1 matches all three dimensions
      expect(result).toContain("**Total events**: 1");
    });

    // GA-S3: Three-dimensional filter combinations (b) phase + work_item
    it("(3D-b) phase + work_item — only rows matching both pass, non-matching rows excluded", async () => {
      // Dataset: rows matching all/some/none of the two filters
      const nodes: MockNodes = new Map([
        // Matches both: phase="execute", work_item="WI-500"
        ["n1", makeNode("n1", "e", { phase: "execute", work_item: "WI-500" }, {})],
        // Matches both again
        ["n2", makeNode("n2", "e", { phase: "execute", work_item: "WI-500" }, {})],
        // Matches phase but NOT work_item
        ["n3", makeNode("n3", "e", { phase: "execute", work_item: "WI-501" }, {})],
        // Matches work_item but NOT phase
        ["n4", makeNode("n4", "e", { phase: "review", work_item: "WI-500" }, {})],
        // Matches neither
        ["n5", makeNode("n5", "e", { phase: "review", work_item: "WI-999" }, {})],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, {
        filter: { phase: "execute", work_item: "WI-500" },
      });

      expect(result).toContain("Filters**: work_item: WI-500, phase: execute");
      // Only n1 and n2 match both dimensions
      expect(result).toContain("**Total events**: 2");
    });
  });

  describe("scope selection", () => {
    it("returns all scopes when scope is undefined", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", { work_item: "WI-1" }, { cycleCreated: 1 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, {});

      expect(result).toContain("Agent Aggregates");
      expect(result).toContain("Work Item Aggregates");
      expect(result).toContain("Cycle Aggregates");
    });

    it("returns only agent scope when scope is 'agent'", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", { work_item: "WI-1" }, { cycleCreated: 1 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "agent" });

      expect(result).toContain("Agent Aggregates");
      expect(result).not.toContain("Work Item Aggregates");
      expect(result).not.toContain("Cycle Aggregates");
    });

    it("returns only work_item scope when scope is 'work_item'", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", { work_item: "WI-1" }, { cycleCreated: 1 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "work_item" });

      expect(result).not.toContain("Agent Aggregates");
      expect(result).toContain("Work Item Aggregates");
      expect(result).not.toContain("Cycle Aggregates");
    });

    it("returns only cycle scope when scope is 'cycle'", async () => {
      const nodes: MockNodes = new Map([
        ["m1", makeNode("m1", "agent", { work_item: "WI-1" }, { cycleCreated: 1 })],
      ]);
      const { adapter } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { scope: "cycle" });

      expect(result).not.toContain("Agent Aggregates");
      expect(result).not.toContain("Work Item Aggregates");
      expect(result).toContain("Cycle Aggregates");
    });
  });

  describe("RemoteAdapter path (mock adapter, no ctx.db)", () => {
    it("returns metrics from adapter without touching ctx.db", async () => {
      // Simulate a RemoteAdapter scenario: ctx.db is undefined.
      // handleGetMetrics must fetch all data from the adapter via getMetricsEvents.
      const nodes: MockNodes = new Map([
        [
          "remote-m1",
          makeNode(
            "remote-m1",
            "code-reviewer",
            { agent_type: "code-reviewer", work_item: "WI-42" },
            { inputTokens: 1500, outputTokens: 700, outcome: "pass", cycleCreated: 7 }
          ),
        ],
        [
          "remote-m2",
          makeNode(
            "remote-m2",
            "architect",
            { agent_type: "architect", work_item: "WI-43" },
            { inputTokens: 8000, outputTokens: 3000, cycleCreated: 7 }
          ),
        ],
      ]);
      const { adapter, getMetricsEventsCalls, queryNodesCalls, getNodesCalls } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter); // ctx.db is undefined

      const result = await handleGetMetrics(ctx, { scope: "agent" });

      // Exactly one adapter call (getMetricsEvents), not queryNodes+getNodes
      expect(getMetricsEventsCalls).toHaveLength(1);
      expect(queryNodesCalls).toHaveLength(0);
      expect(getNodesCalls).toHaveLength(0);

      // Verify results come from the mock adapter's data
      expect(result).toContain("code-reviewer");
      expect(result).toContain("architect");
      expect(result).toContain("**Total events**: 2");
      expect(result).toContain("1500"); // input tokens for code-reviewer
    });

    it("getMetricsEvents is called exactly once even with zero results", async () => {
      const { adapter, getMetricsEventsCalls, queryNodesCalls, getNodesCalls } = buildMockAdapter(new Map());
      const ctx = makeCtx(adapter);

      await handleGetMetrics(ctx, {});

      // One call to getMetricsEvents, no calls to queryNodes or getNodes
      expect(getMetricsEventsCalls).toHaveLength(1);
      expect(queryNodesCalls).toHaveLength(0);
      expect(getNodesCalls).toHaveLength(0);
    });

    it("cycle filter applied via getMetricsEvents (O(1) adapter call, no SQL cycle column)", async () => {
      const nodes: MockNodes = new Map([
        ["r1", makeNode("r1", "agent", { agent_type: "agent-x" }, { cycleCreated: 3 })],
        ["r2", makeNode("r2", "agent", { agent_type: "agent-x" }, { cycleCreated: 4 })],
        ["r3", makeNode("r3", "agent", { agent_type: "agent-x" }, { cycleCreated: 3 })],
      ]);
      const { adapter, getMetricsEventsCalls } = buildMockAdapter(nodes);
      const ctx = makeCtx(adapter);

      const result = await handleGetMetrics(ctx, { filter: { cycle: 3 } });

      // getMetricsEvents is called once with the cycle filter embedded
      expect(getMetricsEventsCalls).toHaveLength(1);
      expect(result).toContain("**Total events**: 2");
    });
  });
});
