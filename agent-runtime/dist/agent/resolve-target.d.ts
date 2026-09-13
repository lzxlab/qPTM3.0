import { InvestigationMemory } from "../context/memory.js";
import { type QptmToolResult } from "../mcp/hub.js";
export declare function applyResolvedIdentity(memory: InvestigationMemory, result: Pick<QptmToolResult, "resolved" | "data">): void;
/** Resolve gene/site → UniProt on every user turn (no stale-session short-circuit). */
export declare function resolveSessionTarget(memory: InvestigationMemory, query: string): Promise<QptmToolResult>;
export declare function invokeArgumentsJson(memory: InvestigationMemory, query: string, extra?: {
    entity?: string;
}): string;
export declare function resolvedBanner(memory: InvestigationMemory, lang: "zh" | "en"): string;
