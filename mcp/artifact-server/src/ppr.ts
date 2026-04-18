// ppr.ts — Personalized PageRank (PPR) algorithm for ideate artifact graph
//
// Computes PPR scores for nodes in the artifact graph, starting from one or
// more seed nodes. Scores represent contextual relevance: higher-scoring nodes
// are more relevant to the seeds given the graph structure.
//
// Algorithm overview:
//   1. BFS from seed nodes up to maxHops hops (options.maxHops ?? DEFAULT_MAX_HOPS=4,
//      skipping containment edges) to collect the reachable subgraph node set.
//   2. Load edges only among visited nodes (using existing source/target indexes).
//   3. Build undirected adjacency (each directed edge is traversable both ways).
//   4. Initialise seed nodes to 1/|seeds|, all others to 0.
//   5. Iterate until convergence:
//        new_score[v] = alpha * seed_score[v]
//                     + (1 - alpha) * Σ(weighted_score[u] / out_degree[u])
//      where u iterates over neighbours of v and weighted_score = score * edge_weight.
//   6. Apply node specificity dampening: multiply by log(totalNodes / max(1, inDegree)).
//   7. Return nodes sorted by score descending.

import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import type * as dbSchema from "./db.js";
import { edges } from "./db.js";
import { ValidationError } from "./adapter.js";
import type { EdgeType } from "./adapter.js";
import { CONTAINMENT_EDGE_TYPES } from "./schema.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PPROptions {
  /** Restart probability — probability of teleporting back to a seed node. Default: 0.15 */
  alpha?: number;
  /** Maximum number of iterations before stopping. Default: 50 */
  maxIterations?: number;
  /** Stop when max score delta between iterations is below this threshold. Default: 1e-6 */
  convergenceThreshold?: number;
  /**
   * Per-edge-type multipliers applied to score propagation.
   * Edges with unlisted types get weight 1.0.
   */
  edgeTypeWeights?: Record<string, number>;
  /**
   * Maximum number of nodes to process. Kept for backward compatibility but
   * ignored inside computePPR — the caller (LocalAdapter.traverse) applies
   * max_nodes as a result-count slice after PPR scoring.
   */
  maxNodes?: number;
  /**
   * Maximum BFS hops from seeds when building the reachable subgraph.
   * Resolves as: options.maxHops ?? config.ppr.max_hops ?? 4.
   * Callers should pass the value from getConfigWithDefaults().ppr.max_hops.
   */
  maxHops?: number;
}

export interface PPRResult {
  nodeId: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

const DEFAULT_ALPHA = 0.15;
const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_CONVERGENCE_THRESHOLD = 1e-6;

/**
 * Default maximum BFS hops from seeds when building the reachable subgraph.
 * Edges outside this radius are not loaded, keeping the edge set small
 * for large graphs. Overridden by options.maxHops (which callers populate
 * from config.ppr.max_hops via getConfigWithDefaults()).
 */
const DEFAULT_MAX_HOPS = 4;

// ---------------------------------------------------------------------------
// bfsReachableNodes — collect node IDs reachable from seeds within max_hops
// ---------------------------------------------------------------------------

/**
 * BFS from the given seeds up to maxHops hops outward, using the edge
 * indexes on the underlying SQLite database.  Containment edges are skipped
 * so that structural parent-child hierarchies do not pollute the semantic
 * traversal radius.
 *
 * Returns a Set of all visited node IDs (seeds are always included).
 *
 * @param rawDb  The underlying better-sqlite3 Database instance ($client).
 * @param seeds  Starting node IDs.
 * @param maxHops  Maximum BFS depth.
 */
function bfsReachableNodes(
  rawDb: Database.Database,
  seeds: string[],
  maxHops: number
): Set<string> {
  const visited = new Set<string>(seeds);
  let frontier = [...seeds];

  // Prepared statements for forward and reverse edge lookups via index.
  // Parameterised by a single node id; we iterate the frontier one node at
  // a time to keep query complexity O(frontier * edges_per_node) rather than
  // requiring an IN clause of variable length.
  interface EdgeRow { source_id: string; target_id: string; edge_type: string }
  const fwdStmt = rawDb.prepare<string[], EdgeRow>(
    "SELECT source_id, target_id, edge_type FROM edges WHERE source_id = ?"
  );
  const revStmt = rawDb.prepare<string[], EdgeRow>(
    "SELECT source_id, target_id, edge_type FROM edges WHERE target_id = ?"
  );

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      // Expand forward edges (nodeId → neighbour)
      const fwdEdges = fwdStmt.all(nodeId);
      for (const e of fwdEdges) {
        if (CONTAINMENT_EDGE_TYPES.has(e.edge_type as EdgeType)) continue;
        if (!visited.has(e.target_id)) {
          visited.add(e.target_id);
          nextFrontier.push(e.target_id);
        }
      }

      // Expand reverse edges (neighbour → nodeId) — undirected traversal
      const revEdges = revStmt.all(nodeId);
      for (const e of revEdges) {
        if (CONTAINMENT_EDGE_TYPES.has(e.edge_type as EdgeType)) continue;
        if (!visited.has(e.source_id)) {
          visited.add(e.source_id);
          nextFrontier.push(e.source_id);
        }
      }
    }

    frontier = nextFrontier;
  }

  return visited;
}

/**
 * DEFAULT_EDGE_TYPE_WEIGHTS — explicit weights for every registered edge type.
 *
 * Previously only 5 of 16 edge types were listed; the rest silently defaulted
 * to 1.0. This table now covers all types in EDGE_TYPE_REGISTRY so every edge
 * has a deliberate, documented weight. PPR scores shift because 11 edge types
 * previously defaulted to 1.0 and now have lower, more appropriate weights.
 *
 * Containment edges (belongs_to_module, belongs_to_project, belongs_to_phase,
 * belongs_to_cycle) are excluded from PPR traversal by the CONTAINMENT_EDGE_TYPES
 * guard in computePPR, so their weights here are never consulted. They are
 * listed explicitly so the coverage regression test can assert completeness.
 *
 * Groups and rationale:
 *
 * DEPENDENCY — edges that express execution-order or blocking relationships.
 *   Strong semantic signal; higher weights reflect strong coupling.
 *   depends_on: 1.0 — direct prerequisite; highest relevance
 *   blocks:     0.3 — blocking relationship flows backwards; less relevant for
 *               forward context assembly
 *
 * GOVERNANCE — edges that link artifacts to controlling principles or policies.
 *   governed_by: 0.8 — governing constraint is very relevant to context
 *   informed_by: 0.6 — informing decision is moderately relevant
 *
 * DERIVATION — edges that express intellectual derivation or resolution.
 *   derived_from:  0.5 — domain policy derived from a principle; medium signal
 *   addressed_by:  0.5 — finding/question resolved by a work item; medium signal
 *   amended_by:    0.4 — later revision weakens relevance of the amended node
 *
 * REFERENCE — generic cross-references with lower specificity.
 *   relates_to:  0.4 — generic association; useful but weak signal
 *   references:  0.4 — generic cross-reference; same tier as relates_to
 *
 * TEMPORAL / HISTORICAL — edges tracking historical replacement or causation.
 *   supersedes:    0.3 — older artifact is less relevant once superseded
 *   triggered_by:  0.3 — causal link; relevant but not primary context
 *
 * DOMAIN MEMBERSHIP — belongs_to_domain is NOT a containment edge (not in
 *   CONTAINMENT_EDGE_TYPES) but is still a weak organisational signal.
 *   belongs_to_domain: 0.2 — domain tag; very broad association, low weight
 *
 * CONTAINMENT (never traversed by PPR — listed for coverage completeness only):
 *   belongs_to_module:  0.0
 *   belongs_to_project: 0.0
 *   belongs_to_phase:   0.0
 *   belongs_to_cycle:   0.0
 */
export const DEFAULT_EDGE_TYPE_WEIGHTS: Record<string, number> = {
  // --- Dependency -----------------------------------------------------------
  depends_on: 1.0,
  blocks: 0.3,

  // --- Governance -----------------------------------------------------------
  governed_by: 0.8,
  informed_by: 0.6,

  // --- Derivation -----------------------------------------------------------
  derived_from: 0.5,
  addressed_by: 0.5,
  amended_by: 0.4,

  // --- Reference ------------------------------------------------------------
  relates_to: 0.4,
  references: 0.4,

  // --- Temporal / Historical ------------------------------------------------
  supersedes: 0.3,
  triggered_by: 0.3,

  // --- Domain membership (weak organisational signal) -----------------------
  belongs_to_domain: 0.2,

  // --- Containment (excluded from PPR traversal; listed for coverage only) --
  belongs_to_module: 0.0,
  belongs_to_project: 0.0,
  belongs_to_phase: 0.0,
  belongs_to_cycle: 0.0,
};

// ---------------------------------------------------------------------------
// computePPR
// ---------------------------------------------------------------------------

/**
 * Compute Personalized PageRank scores for all nodes reachable from seedNodeIds.
 *
 * @param drizzleDb  Drizzle ORM database instance backed by better-sqlite3.
 * @param rawDb      The underlying better-sqlite3 Database instance (used for BFS queries).
 * @param seedNodeIds  IDs of the nodes to use as the restart set.
 * @param options  Optional algorithm parameters. Pass options.maxHops (from
 *                 getConfigWithDefaults().ppr.max_hops) to control BFS radius;
 *                 defaults to DEFAULT_MAX_HOPS (4) when omitted.
 * @returns Array of {nodeId, score} sorted by score descending.
 */
export function computePPR(
  drizzleDb: BetterSQLite3Database<typeof dbSchema>,
  rawDb: Database.Database,
  seedNodeIds: string[],
  options?: PPROptions
): PPRResult[] {
  const alpha = options?.alpha ?? DEFAULT_ALPHA;
  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const convergenceThreshold = options?.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const maxHops = options?.maxHops ?? DEFAULT_MAX_HOPS;

  // Edge type weight keys are lower_snake_case (canonical form per schema.ts)
  const edgeTypeWeights: Record<string, number> = options?.edgeTypeWeights ?? DEFAULT_EDGE_TYPE_WEIGHTS;

  // Validate alpha: must be 0 < alpha <= 1
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new ValidationError(
      `alpha must be between 0 and 1 (exclusive of 0, inclusive of 1), received ${alpha}`,
      "INVALID_ALPHA",
      { value: alpha }
    );
  }

  // Validate maxIterations: must be positive integer
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new ValidationError(
      `maxIterations must be a positive integer, received ${maxIterations}`,
      "INVALID_MAX_ITERATIONS",
      { value: maxIterations }
    );
  }

  // Validate convergenceThreshold: must be positive number
  if (!Number.isFinite(convergenceThreshold) || convergenceThreshold <= 0) {
    throw new ValidationError(
      `convergenceThreshold must be a positive number, received ${convergenceThreshold}`,
      "INVALID_CONVERGENCE_THRESHOLD",
      { value: convergenceThreshold }
    );
  }

  // Short-circuit: empty seeds → empty result
  if (seedNodeIds.length === 0) {
    return [];
  }

  // -------------------------------------------------------------------------
  // Step 1: BFS to collect the reachable subgraph within MAX_HOPS hops, then
  //         load only edges among visited nodes.
  //
  // For small graphs (all existing tests) the BFS subgraph == the full graph,
  // so PPR scores are identical to the previous full-load approach.  For large
  // production graphs this avoids loading thousands of unrelated edges.
  // -------------------------------------------------------------------------

  // 1a. BFS — collect all node IDs reachable from seeds within maxHops hops.
  //     Containment edges are excluded from traversal inside bfsReachableNodes.
  const visitedNodeIds = bfsReachableNodes(rawDb, seedNodeIds, maxHops);

  // 1b. Load edges where both source_id and target_id are in the visited set.
  //     We load via Drizzle ORM and filter in-memory — this avoids a variable-
  //     length SQL IN clause and keeps the query simple.  The idx_edges_source
  //     index is still used when the optimizer scans by source_id ranges.
  //
  //     A future optimisation could use raw SQL with a temp table for very
  //     large visited sets, but for typical artifact graphs this is adequate.
  const allEdges = drizzleDb
    .select({
      source_id: edges.source_id,
      target_id: edges.target_id,
      edge_type: edges.edge_type,
    })
    .from(edges)
    .all()
    .filter((e) => visitedNodeIds.has(e.source_id) && visitedNodeIds.has(e.target_id));

  log.debug("ppr", `traverse fetched ${allEdges.length} edges (${visitedNodeIds.size} visited nodes, max_hops=${maxHops})`);

  // -------------------------------------------------------------------------
  // Step 2: Collect all node IDs and build adjacency structures
  //
  // We treat the graph as undirected for PPR traversal, so each directed edge
  // (source → target) becomes two entries in the adjacency list. This lets
  // relevance flow in both directions, which is appropriate when we want to
  // surface nodes that depend on, or are depended upon by, the seeds.
  //
  // adj[nodeId] = Array of {neighbour, weight} representing edges to walk.
  // inDegree[nodeId] = number of directed edges pointing AT this node
  //                    (used for specificity dampening only — not adjacency).
  // -------------------------------------------------------------------------

  // nodeSet starts from visitedNodeIds (already includes seeds + BFS reachable)
  const nodeSet = new Set<string>(visitedNodeIds);
  for (const e of allEdges) {
    nodeSet.add(e.source_id);
    nodeSet.add(e.target_id);
  }
  const allNodeIds = Array.from(nodeSet);
  const totalNodes = allNodeIds.length;

  // adj: undirected adjacency — for each node, the list of weighted neighbours
  const adj = new Map<string, Array<{ neighbour: string; weight: number }>>();
  for (const id of allNodeIds) {
    adj.set(id, []);
  }

  // inDegree: directed in-degree (used for specificity dampening)
  const inDegree = new Map<string, number>();
  for (const id of allNodeIds) {
    inDegree.set(id, 0);
  }

  for (const e of allEdges) {
    // Skip containment edges (organizational hierarchy)
    if (CONTAINMENT_EDGE_TYPES.has(e.edge_type as EdgeType)) continue;

    // Look up weight directly — e.edge_type is lower_snake_case per schema.ts
    const w = edgeTypeWeights[e.edge_type] ?? 1.0;

    // Skip edges with zero weight — they contribute nothing to score propagation
    if (w === 0) continue;

    // source → target (forward direction)
    adj.get(e.source_id)!.push({ neighbour: e.target_id, weight: w });
    // target → source (reverse direction — undirected traversal)
    adj.get(e.target_id)!.push({ neighbour: e.source_id, weight: w });

    // Update directed in-degree for target only
    inDegree.set(e.target_id, (inDegree.get(e.target_id) ?? 0) + 1);
  }

  // Initialize inDegree for isolated seeds to prevent specificity dampening from zeroing them out.
  // This matches the server-side PPR behavior in ideate-server/src/services/ppr.ts
  for (const seed of seedNodeIds) {
    if (!inDegree.has(seed)) {
      inDegree.set(seed, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Initialise scores
  //
  // Seed nodes each receive 1/|seeds|; all others start at 0.
  // -------------------------------------------------------------------------

  const seedSet = new Set<string>(seedNodeIds);
  const seedScore = 1.0 / seedNodeIds.length;

  const scores = new Map<string, number>();
  for (const id of allNodeIds) {
    scores.set(id, seedSet.has(id) ? seedScore : 0.0);
  }

  // -------------------------------------------------------------------------
  // Step 4: Iterate PPR until convergence
  // -------------------------------------------------------------------------

  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = new Map<string, number>();

    // Initialize with 0 for all nodes.
    for (const id of allNodeIds) {
      newScores.set(id, 0.0);
    }

    // Propagate scores along edges
    // For each node u, distribute its score to neighbours proportionally
    // to their edge weights divided by u's total weighted out-degree.
    for (const u of allNodeIds) {
      const uScore = scores.get(u)!;
      if (uScore === 0.0) continue;

      const neighbours = adj.get(u)!;
      if (neighbours.length === 0) continue;

      // Compute the total weighted out-degree (sum of weights on all edges from u)
      let totalWeight = 0.0;
      for (const { weight } of neighbours) {
        totalWeight += weight;
      }
      if (totalWeight === 0.0) continue;

      for (const { neighbour, weight } of neighbours) {
        const contribution = (1.0 - alpha) * uScore * (weight / totalWeight);
        newScores.set(neighbour, newScores.get(neighbour)! + contribution);
      }
    }

    // Add teleportation mass back to seed nodes.
    if (seedNodeIds.length > 0) {
      for (const seed of seedNodeIds) {
        newScores.set(seed, (newScores.get(seed) ?? 0.0) + alpha * seedScore);
      }
    }

    // Check convergence: max absolute delta across all nodes
    let maxDelta = 0.0;
    for (const id of allNodeIds) {
      const delta = Math.abs((newScores.get(id) ?? 0.0) - (scores.get(id) ?? 0.0));
      if (delta > maxDelta) maxDelta = delta;
    }

    // Update scores
    for (const id of allNodeIds) {
      scores.set(id, newScores.get(id)!);
    }

    if (maxDelta < convergenceThreshold) {
      break;
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Apply node specificity dampening (IDF-like)
  //
  // Nodes with very high in-degree are "hub" nodes — they appear in many
  // relationships and are therefore less specific/informative. We dampen their
  // scores proportionally:
  //
  //   score *= log(totalNodes / max(1, inDegree))
  //
  // log here is natural log. Nodes with inDegree=0 receive the maximum factor
  // (log(totalNodes)), while a hub node with inDegree ≈ totalNodes gets ~0.
  //
  // When totalNodes=1 the factor is log(1)=0. To avoid zeroing out all scores
  // in degenerate single-node graphs, we skip dampening in that case.
  // -------------------------------------------------------------------------

  if (totalNodes > 1) {
    for (const id of allNodeIds) {
      const deg = inDegree.get(id) ?? 0;
      const specificityFactor = Math.log(totalNodes / Math.max(1, deg));
      scores.set(id, scores.get(id)! * specificityFactor);
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Build and sort results
  // -------------------------------------------------------------------------

  const results: PPRResult[] = [];
  for (const id of allNodeIds) {
    results.push({ nodeId: id, score: scores.get(id)! });
  }

  results.sort((a, b) => b.score - a.score);

  return results;
}
