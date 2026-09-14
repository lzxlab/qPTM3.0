import { serve } from "@hono/node-server";
import { cfg } from "./config.js";
import { app } from "./server.js";
import { initConversationsDb } from "./storage/conversations.js";
import { initQptmMcp } from "./mcp/hub.js";

async function main() {
  initConversationsDb();
  // Warm qPTM MCP in background — do not block HTTP on MCP connect.
  initQptmMcp().catch((e) => console.warn("qPTM MCP preload failed:", e));

  serve({
    fetch: app.fetch,
    hostname: cfg.host,
    port: cfg.port,
  });

  console.log(`qPTM agent-runtime listening on http://${cfg.host}:${cfg.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
