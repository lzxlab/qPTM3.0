import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cfg } from "../config.js";
let qptmClient = null;
let qptmInitPromise = null;
let cachedMcpTools = null;
/** In-flight stdio transport — closed on connect timeout to avoid orphan processes. */
let pendingQptmTransport = null;
const MCP_CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS || 15000);
const MCP_CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS || 120000);
async function killTransport(transport) {
    if (!transport)
        return;
    try {
        await transport.close();
    }
    catch {
        /* ignore */
    }
}
async function connectStdio(name, command, args, cwd) {
    let transport = null;
    try {
        transport = new StdioClientTransport({
            command,
            args,
            cwd,
            stderr: "pipe",
        });
        if (name === "qptm")
            pendingQptmTransport = transport;
        const client = new Client({ name: `qptm-agent-${name}`, version: "2.0.0" });
        await client.connect(transport);
        if (name === "qptm")
            pendingQptmTransport = null;
        console.log(`MCP ${name} connected (${command} ${args.join(" ")})`);
        return { name, client, transport };
    }
    catch (e) {
        if (name === "qptm")
            pendingQptmTransport = null;
        await killTransport(transport);
        console.warn(`MCP ${name} connect failed:`, e);
        return null;
    }
}
async function connectStdioWithTimeout(name, command, args, cwd) {
    let timer;
    let timedOut = false;
    const connectPromise = connectStdio(name, command, args, cwd);
    try {
        const result = await Promise.race([
            connectPromise,
            new Promise((resolve) => {
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
                if (late)
                    void killTransport(late.transport);
            });
            return null;
        }
        return result;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/** Connect qPTM stdio MCP. Retries after failed connect. */
export async function initQptmMcp() {
    if (qptmClient)
        return;
    if (qptmInitPromise)
        return qptmInitPromise;
    qptmInitPromise = (async () => {
        qptmClient = await connectStdioWithTimeout("qptm", cfg.qptmMcpCommand, cfg.qptmMcpArgs, cfg.qptmMcpCwd);
        if (!qptmClient) {
            qptmInitPromise = null;
        }
    })();
    return qptmInitPromise;
}
/** @deprecated Use initQptmMcp — kept for callers that only need qPTM tools. */
export async function initMcpClients() {
    await initQptmMcp();
}
async function ensureQptmMcp() {
    await initQptmMcp();
}
export function qptmMcpConnected() {
    return qptmClient != null;
}
export async function pingQptmMcp() {
    await ensureQptmMcp();
    if (!qptmClient)
        return false;
    try {
        await qptmClient.client.listTools();
        return true;
    }
    catch {
        await resetQptmMcpClient();
        return false;
    }
}
async function resetQptmMcpClient() {
    if (qptmClient) {
        await killTransport(qptmClient.transport);
        qptmClient = null;
    }
    cachedMcpTools = null;
    qptmInitPromise = null;
}
export async function listMcpTools() {
    await ensureQptmMcp();
    if (!qptmClient)
        return [];
    if (cachedMcpTools)
        return cachedMcpTools;
    try {
        const res = await qptmClient.client.listTools();
        cachedMcpTools = (res.tools || []).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        }));
        return cachedMcpTools;
    }
    catch {
        await resetQptmMcpClient();
        return [];
    }
}
export async function readQptmResource(uri) {
    await ensureQptmMcp();
    if (!qptmClient)
        return "";
    try {
        const res = await qptmClient.client.readResource({ uri });
        return res.contents
            .map((c) => ("text" in c ? c.text : "") || "")
            .join("\n");
    }
    catch {
        return "";
    }
}
function parseToolPayload(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
export async function callQptmTool(toolName, args) {
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
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`MCP callTool timeout after ${MCP_CALL_TIMEOUT_MS}ms`)), MCP_CALL_TIMEOUT_MS);
            }),
        ]);
        const content = (result.content || []);
        const text = content
            .map((c) => c.text || "")
            .filter(Boolean)
            .join("\n");
        const parsed = parseToolPayload(text);
        const payloadSuccess = parsed.success;
        const success = !result.isError && (payloadSuccess === undefined ? true : payloadSuccess !== false);
        const dataObj = parsed.data && typeof parsed.data === "object"
            ? parsed.data
            : null;
        const resolved = parsed.resolved ||
            (dataObj && (dataObj.uniprot_ac || dataObj.gene) ? dataObj : null);
        const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : undefined;
        const blockSummary = blocks?.length
            ? blocks
                .map((b) => {
                const row = b;
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
            error_kind: parsed.error_kind ?? (success ? null : "tool_error"),
            missing: Array.isArray(parsed.missing) ? parsed.missing : [],
            resolved,
        };
    }
    catch (e) {
        return { success: false, summary: String(e), data: null, error_kind: "call_bug" };
    }
}
/**
 * Search PubTator3 + PubMed esearch + Europe PMC (merged in MCP search_literature).
 */
export async function searchLiteratureArticles(query, limit) {
    const q = (query || "").trim();
    if (!q)
        return "";
    const cap = Math.max(1, Math.min(limit || cfg.litSearchLimit, 50));
    const viaSearch = await callQptmTool("search_literature", { query: q, limit: cap });
    if (viaSearch.success || viaSearch.summary) {
        const dataStr = typeof viaSearch.data === "string"
            ? viaSearch.data
            : JSON.stringify(viaSearch.data ?? {});
        const blockStr = viaSearch.blocks ? JSON.stringify(viaSearch.blocks) : "";
        const combined = `${viaSearch.summary || ""}\n${blockStr}\n${dataStr}`;
        if (/PMID/i.test(combined) || /publication|Merged|esearch|Europe PMC/i.test(viaSearch.summary || "")) {
            return combined.slice(0, 16000);
        }
        if (viaSearch.summary) {
            return `${viaSearch.summary}\n${JSON.stringify(viaSearch.data ?? {})}`.slice(0, 16000);
        }
    }
    return viaSearch.summary || "Literature search unavailable";
}
export function isWebSearchFailure(text) {
    return text.startsWith("Web search failed") || text.startsWith("Web search unavailable");
}
export async function webSearch(query) {
    if (!cfg.tavilyApiKey) {
        return "Web search unavailable: Tavily not configured";
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
        if (!res.ok) {
            return `Web search failed: Tavily HTTP ${res.status}`;
        }
        const data = (await res.json());
        return (data.results || [])
            .map((r) => `${r.title}\n${r.content}\n${r.url}`)
            .join("\n---\n")
            .slice(0, 4000);
    }
    catch (e) {
        return `Web search failed: ${e}`;
    }
    finally {
        clearTimeout(t);
    }
}
