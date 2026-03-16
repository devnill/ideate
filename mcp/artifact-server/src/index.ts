import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, handleTool } from "./tools.js";
import { artifactWatcher } from "./watcher.js";

const server = new Server(
  { name: "ideate-artifact-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  artifactWatcher.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  artifactWatcher.close();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
