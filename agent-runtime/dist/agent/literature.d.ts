import type { QptmToolResult } from "../mcp/hub.js";
export type LitPaper = {
    pmid: string;
    title: string;
    abstract: string;
    fulltext?: string;
    score?: number;
};
export declare function extractPmids(text: string, max?: number): string[];
export declare function papersFromToolResult(result: QptmToolResult | null | undefined): LitPaper[];
export declare function papersNeedAbstracts(papers: LitPaper[]): boolean;
export declare function mergeLiteratureResults(search: QptmToolResult, abstracts: QptmToolResult): QptmToolResult;
