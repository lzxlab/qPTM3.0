export type McpToolDef = {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
};
/** Connect qPTM stdio MCP. Retries after failed connect. */
export declare function initQptmMcp(): Promise<void>;
/** @deprecated Use initQptmMcp — kept for callers that only need qPTM tools. */
export declare function initMcpClients(): Promise<void>;
export declare function qptmMcpConnected(): boolean;
export declare function pingQptmMcp(): Promise<boolean>;
export declare function listMcpTools(): Promise<McpToolDef[]>;
export declare function readQptmResource(uri: string): Promise<string>;
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
export declare function callQptmTool(toolName: string, args: Record<string, unknown>): Promise<QptmToolResult>;
/**
 * Search PubTator3 + PubMed esearch + Europe PMC (merged in MCP search_literature).
 */
export declare function searchLiteratureArticles(query: string, limit?: number): Promise<string>;
export declare function isWebSearchFailure(text: string): boolean;
export declare function webSearch(query: string): Promise<string>;
