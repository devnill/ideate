/**
 * Rough token-count estimate using the characters/4 heuristic.
 *
 * Approximation: `Math.floor(text.length / 4)`
 *
 * Accuracy bounds (accepted contract):
 *   - ASCII text:          ±30%
 *   - Non-ASCII / multi-byte text (e.g. CJK, emoji): ±50% (worst case)
 *
 * Tradeoff rationale: importing js-tiktoken adds measurable startup latency,
 * and switching to cl100k_base would require re-indexing all stored
 * `token_count` values. The ±50% bound is accepted as-is at current scale.
 *
 * For precise per-event token counting see instrumentation.ts (metric-path).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Characters/4 heuristic — accuracy ±30% ASCII, ±50% non-ASCII multi-byte.
  return Math.floor(text.length / 4);
}
