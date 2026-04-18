// tools/diagnostics.ts — ideate_check_workspace tool handler
//
// Thin wrapper that delegates all workspace integrity logic to the adapter's
// checkWorkspace() method. All four checks (orphan nodes, unindexed YAML,
// dangling edges, stale addressed_by) are implemented in:
//   - LocalAdapter: adapters/local/reader.ts → LocalReaderAdapter.checkWorkspace()
//   - RemoteAdapter: NOT_SUPPORTED (throws StorageAdapterError)

import type { ToolContext } from "../types.js";

export async function handleCheckWorkspace(
  ctx: ToolContext,
  _args: Record<string, unknown>
): Promise<string> {
  if (!ctx.adapter) {
    throw new Error(
      "handleCheckWorkspace requires ctx.adapter to be set. " +
        "This is a configuration error — the server and all tests must provide an adapter."
    );
  }
  const report = await ctx.adapter.checkWorkspace();
  return JSON.stringify(report, null, 2);
}
