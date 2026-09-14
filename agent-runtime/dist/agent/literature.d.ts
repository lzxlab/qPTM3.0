import type { InvestigationMemory } from "../context/memory.js";
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
export declare function geneLikeTokens(text: string, exclude?: string[], max?: number): string[];
export declare function normalizeLitQuery(q: string): string;
export declare function entitiesMissingFromQuery(query: string, entities: string[]): string[];
export declare function withFrontierEntities(query: string, entities: string[], max?: number): string;
export declare function literatureTokens(memory: Pick<InvestigationMemory, "gene" | "position" | "ptm_type">, focus?: string, question?: string): string[];
export declare function rankLiteraturePapers(papers: LitPaper[], tokens: string[], gene?: string | null): LitPaper[];
