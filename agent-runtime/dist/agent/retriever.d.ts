import { InvestigationMemory } from "../context/memory.js";
/** MCP intent tools exposed via tools/list (not registry tool names). */
export declare const MCP_INTENT_TOOLS: readonly ["resolve_ptm_target", "search_ptm_sites", "get_site_conditions", "get_upstream_enzymes", "get_function_disease", "get_llps", "get_drug_ptm", "get_localization", "get_ppi_pathways", "search_literature"];
export type McpIntentTool = (typeof MCP_INTENT_TOOLS)[number];
/** Rank MCP intent tools for a research question (replaces legacy registry tool names). */
export declare function retrieveIntentTools(question: string, memory: InvestigationMemory, topK?: number): McpIntentTool[];
export declare function retrieveIntentToolsDeep(question: string, memory: InvestigationMemory): McpIntentTool[];
/** @deprecated Use retrieveIntentTools */
export declare function retrieveTools(question: string, memory: InvestigationMemory, topK?: number): string[];
/** @deprecated Use retrieveIntentToolsDeep */
export declare function retrieveToolsDeep(question: string, memory: InvestigationMemory): string[];
