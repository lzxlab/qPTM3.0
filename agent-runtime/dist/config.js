import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv({ path: resolve(__dirname, "../../agent-backend/.env") });
dotenv({ path: resolve(__dirname, "../.env") });
const BLOCKED_MODELS = new Set(["qwen3.7-max"]);
function splitCsv(s) {
    return (s || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => {
        const bare = x.includes("/") ? x.split("/").pop() || x : x;
        return !BLOCKED_MODELS.has(x.toLowerCase()) && !BLOCKED_MODELS.has(bare.toLowerCase());
    });
}
export const cfg = {
    port: Number(process.env.PORT || 8101),
    host: process.env.HOST || "0.0.0.0",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
    deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || "https://opencode.ai/zen/go/v1").replace(/\/$/, ""),
    deepseekZenBaseUrl: (process.env.DEEPSEEK_ZEN_BASE_URL || "https://opencode.ai/zen/v1").replace(/\/$/, ""),
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    deepseekFallbackModels: splitCsv(process.env.DEEPSEEK_FALLBACK_MODELS),
    conversationsDataDir: resolve(__dirname, "..", process.env.CONVERSATIONS_DATA_DIR || "../agent-backend/runtime/conversations"),
    qptmMcpCommand: process.env.QPTM_MCP_COMMAND || "/var/www/html/qPTM2026/agent-backend/.venv/bin/python",
    qptmMcpArgs: splitCsv(process.env.QPTM_MCP_ARGS || "-m,mcp_stdio_server"),
    qptmMcpCwd: resolve(__dirname, "..", process.env.QPTM_MCP_CWD || "../agent-backend"),
    biomcpCommand: process.env.BIOMCP_COMMAND || "biomcp",
    biomcpArgs: splitCsv(process.env.BIOMCP_ARGS || "serve"),
    tavilyApiKey: process.env.TAVILY_API_KEY || "",
    webSearchTimeoutMs: Number(process.env.WEB_SEARCH_TIMEOUT_MS || 5000),
    /** Per-LLM-attempt timeout (ms). */
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 90000),
    /** Total wall-clock budget for Deep Research report synthesis (ms). */
    drSynthesisTimeoutMs: Number(process.env.DR_SYNTHESIS_TIMEOUT_MS || 180000),
    drSynthesisMaxTokens: Number(process.env.DR_SYNTHESIS_MAX_TOKENS || 4096),
    /** How many models to try before failing DR synthesis (limits 10+ min fallback chains). */
    drSynthesisMaxModels: Number(process.env.DR_SYNTHESIS_MAX_MODELS || 2),
    skillsDir: resolve(__dirname, "..", process.env.SKILLS_DIR || "../skills"),
    qaMaxRounds: 3,
    drMaxPlanSteps: 12,
    drSupervisorMaxRounds: Number(process.env.DR_SUPERVISOR_MAX_ROUNDS || 6),
    corsOrigins: splitCsv(process.env.CORS_ORIGINS || "*"),
    backendBaseUrl: (process.env.AGENT_BACKEND_URL || "http://127.0.0.1:8100").replace(/\/$/, ""),
};
