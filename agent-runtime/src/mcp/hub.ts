import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { cfg } from "../config.js";

type McpClientWrap = {
  name: string;
  client: Client;
  transport: StdioClientTransport;
};

export type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

let qptmClient: McpClientWrap | null = null;
let biomcpClient: McpClientWrap | null = null;
let qptmInitPromise: Promise<void> | null = null;
let biomcpInitPromise: Promise<McpClientWrap | null> | null = null;
let cachedMcpTools: McpToolDef[] | null = null;

/** In-flight stdio transport — closed on connect timeout to avoid orphan processes. */
let pendingQptmTransport: StdioClientTransport | null = null;

const MCP_CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS || 15000);
const MCP_CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS || 120000);

async function killTransport(transport: StdioClientTransport | null): Promise<void> {
  if (!transport) return;
  try {
    await transport.close();
  } catch {
    /* ignore */
  }
}

async function connectStdio(
  name: string,
  command: string,
  args: string[],
  cwd?: string,
): Promise<McpClientWrap | null> {
  let transport: StdioClientTransport | null = null;
  try {
    transport = new StdioClientTransport({
      command,
      args,
      cwd,
      stderr: "pipe",
    });
    if (name === "qptm") pendingQptmTransport = transport;
    const client = new Client({ name: `qptm-agent-${name}`, version: "2.0.0" });
    await client.connect(transport);
    if (name === "qptm") pendingQptmTransport = null;
    console.log(`MCP ${name} connected (${command} ${args.join(" ")})`);
    return { name, client, transport };
  } catch (e) {
    if (name === "qptm") pendingQptmTransport = null;
    await killTransport(transport);
    console.warn(`MCP ${name} connect failed:`, e);
    return null;
  }
}

async function connectStdioWithTimeout(
  name: string,
  command: string,
  args: string[],
  cwd?: string,
): Promise<McpClientWrap | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const connectPromise = connectStdio(name, command, args, cwd);
  try {
    const result = await Promise.race([
      connectPromise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          console.warn(`MCP ${name} connect timed out after ${MCP_CONNECT_TIMEOUT_MS}ms`);
          resolve(null);
        }, MCP_CONNECT_TIMEOUT_MS);
      }),
    ]);
    if (timedOut) {
      await killTransport(pendingQptmTransport);
      pendingQptmTransport = null;
      connectPromise.then((late) => {
        if (late) void killTransport(late.transport);
      });
      return null;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Connect qPTM stdio MCP only — never blocks on BioMCP. Retries after failed connect. */
export async function initQptmMcp(): Promise<void> {
  if (qptmClient) return;
  if (qptmInitPromise) return qptmInitPromise;
  qptmInitPromise = (async () => {
    qptmClient = await connectStdioWithTimeout(
      "qptm",
      cfg.qptmMcpCommand,
      cfg.qptmMcpArgs,
      cfg.qptmMcpCwd,
    );
    if (!qptmClient) {
      qptmInitPromise = null;
    }
  })();
  return qptmInitPromise;
}

/** Lazy BioMCP — optional; failures/timeouts do not block chat. */
async function initBiomcpMcp(): Promise<McpClientWrap | null> {
  if (biomcpClient) return biomcpClient;
  if (biomcpInitPromise) return biomcpInitPromise;
  biomcpInitPromise = connectStdioWithTimeout("biomcp", cfg.biomcpCommand, cfg.biomcpArgs);
  biomcpClient = await biomcpInitPromise;
  return biomcpClient;
}

/** @deprecated Use initQptmMcp — kept for callers that only need qPTM tools. */
export async function initMcpClients(): Promise<void> {
  await initQptmMcp();
}

async function ensureQptmMcp(): Promise<void> {
  await initQptmMcp();
}

export function qptmMcpConnected(): boolean {
  return qptmClient != null;
}

export async function pingQptmMcp(): Promise<boolean> {
  await ensureQptmMcp();
  if (!qptmClient) return false;
  try {
    await qptmClient.client.listTools();
    return true;
  } catch {
    await resetQptmMcpClient();
    return false;
  }
}

async function resetQptmMcpClient(): Promise<void> {
  if (qptmClient) {
    await killTransport(qptmClient.transport);
    qptmClient = null;
  }
  cachedMcpTools = null;
  qptmInitPromise = null;
}

export async function listMcpTools(): Promise<McpToolDef[]> {
  await ensureQptmMcp();
  if (!qptmClient) return [];
  if (cachedMcpTools) return cachedMcpTools;
  try {
    const res = await qptmClient.client.listTools();
    cachedMcpTools = (res.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
    return cachedMcpTools;
  } catch {
    await resetQptmMcpClient();
    return [];
  }
}

async function ensureBiomcpMcp(): Promise<McpClientWrap | null> {
  return initBiomcpMcp();
}

export async function readQptmResource(uri: string): Promise<string> {
  await ensureQptmMcp();
  if (!qptmClient) return "";
  try {
    const res = await qptmClient.client.readResource({ uri });
    return res.contents
      .map((c) => ("text" in c ? c.text : "") || "")
      .join("\n");
  } catch {
    return "";
  }
}

export type QptmToolResult = {
  success: boolean;
  summary: string;
  data: unknown;
  blocks?: unknown[];
  intent?: string;
  error_kind?: string | null;
  missing?: string[];
  resolved?: Record<string, unknown> | null;
};

function parseToolPayload(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

export async function callQptmTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<QptmToolResult> {
  await ensureQptmMcp();
  if (!qptmClient) {
    return {
      success: false,
      summary: "qPTM MCP not connected",
      data: null,
      error_kind: "call_bug",
    };
  }
  try {
    const result = await Promise.race([
      qptmClient.client.callTool({ name: toolName, arguments: args }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`MCP callTool timeout after ${MCP_CALL_TIMEOUT_MS}ms`)), MCP_CALL_TIMEOUT_MS);
      }),
    ]);
    const content = (result.content || []) as Array<{ type: string; text?: string }>;
    const text = content
      .map((c) => c.text || "")
      .filter(Boolean)
      .join("\n");
    const parsed = parseToolPayload(text);
    const payloadSuccess = parsed.success;
    const success =
      !result.isError && (payloadSuccess === undefined ? true : payloadSuccess !== false);
    const dataObj =
      parsed.data && typeof parsed.data === "object"
        ? (parsed.data as Record<string, unknown>)
        : null;
    const resolved =
      (parsed.resolved as Record<string, unknown> | undefined) ||
      (dataObj && (dataObj.uniprot_ac || dataObj.gene) ? dataObj : null);
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : undefined;
    const blockSummary =
      blocks?.length
        ? blocks
            .map((b) => {
              const row = b as Record<string, unknown>;
              return `[${row.source_name || row.tool}] ${row.summary || ""}`;
            })
            .join(" | ")
            .slice(0, 600)
        : "";
    return {
      success,
      summary: String(parsed.summary || blockSummary || text.slice(0, 400)),
      data: parsed.data ?? parsed,
      blocks,
      intent: typeof parsed.intent === "string" ? parsed.intent : undefined,
      error_kind:
        (parsed.error_kind as string | null | undefined) ?? (success ? null : "tool_error"),
      missing: Array.isArray(parsed.missing) ? (parsed.missing as string[]) : [],
      resolved,
    };
  } catch (e) {
    return { success: false, summary: String(e), data: null, error_kind: "call_bug" };
  }
}

export async function callBiomcp(command: string, args: string[] = []): Promise<string> {
  const client = await ensureBiomcpMcp();
  if (!client) {
    return await fallbackBiomcpCli(command, args);
  }
  try {
    const result = await client.client.callTool({
      name: "biomcp",
      arguments: { command, args },
    });
    const content = (result.content || []) as Array<{ type: string; text?: string }>;
    return content.map((c) => c.text || "").join("\n").slice(0, 8000);
  } catch (e) {
    return `BioMCP error: ${e}`;
  }
}

async function fallbackBiomcpCli(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cfg.biomcpCommand, [command, ...args], { timeout: 30000 });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.slice(0, 8000)));
    child.on("error", () => resolve("BioMCP CLI not available"));
  });
}

export async function biomcpSearchArticle(query: string): Promise<string> {
  return callBiomcp("search", ["article", query]);
}

export async function biomcpGetArticle(id: string): Promise<string> {
  return callBiomcp("get", ["article", id]);
}

/**
 * Literature search with a reliable fallback: BioMCP is often unavailable on this host.
 * Prefer qPTM MCP search_literature intent tool.
 */
export async function searchLiteratureArticles(query: string): Promise<string> {
  const q = (query || "").trim();
  if (!q) return "";

  const viaPubtator = await callQptmTool("search_literature", { query: q, limit: 8 });
  if (viaPubtator.success || viaPubtator.summary) {
    const dataStr =
      typeof viaPubtator.data === "string"
        ? viaPubtator.data
        : JSON.stringify(viaPubtator.data ?? {});
    const blockStr = viaPubtator.blocks ? JSON.stringify(viaPubtator.blocks) : "";
    const combined = `${viaPubtator.summary || ""}\n${blockStr}\n${dataStr}`;
    if (/PMID/i.test(combined) || /publication/i.test(viaPubtator.summary || "")) {
      return combined.slice(0, 8000);
    }
  }

  const viaBiomcp = await biomcpSearchArticle(q);
  if (viaBiomcp && !/BioMCP CLI not available|MCP biomcp connect failed|BioMCP error/i.test(viaBiomcp)) {
    return viaBiomcp;
  }
  return viaPubtator.summary
    ? `${viaPubtator.summary}\n${JSON.stringify(viaPubtator.data ?? {})}`.slice(0, 8000)
    : viaBiomcp || "Literature search unavailable";
}

export async function webSearch(query: string): Promise<string> {
  if (!cfg.tavilyApiKey) {
    return await biomcpSearchArticle(query);
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), cfg.webSearchTimeoutMs);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: cfg.tavilyApiKey,
        query,
        max_results: 5,
        search_depth: "basic",
      }),
      signal: controller.signal,
    });
    const data = (await res.json()) as { results?: Array<{ title: string; content: string; url: string }> };
    return (data.results || [])
      .map((r) => `${r.title}\n${r.content}\n${r.url}`)
      .join("\n---\n")
      .slice(0, 4000);
  } catch (e) {
    return `Web search failed: ${e}`;
  } finally {
    clearTimeout(t);
  }
}
