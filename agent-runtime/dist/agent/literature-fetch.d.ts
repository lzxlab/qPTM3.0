import { type QptmToolResult } from "../mcp/hub.js";
/**
 * One ReAct search_literature call: query search + top abstracts when the model
 * did not already pass pmids / fulltext_pmids.
 */
export declare function callSearchLiteratureDeep(args: Record<string, unknown>): Promise<QptmToolResult>;
