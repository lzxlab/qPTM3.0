import type { AbstractRecord } from "../types.js";
export type AbstractSource = "pubmed" | "pubtator3" | "auto";
export interface ResolveAbstractsOptions {
    /** pubmed | pubtator3 | auto (pubmed then pubtator3 for misses) */
    source?: AbstractSource;
    /** Persist newly fetched rows into data/abstracts/api_fetched.csv */
    cache?: boolean;
    onProgress?: (msg: string) => void;
}
export interface ResolveAbstractsResult {
    records: AbstractRecord[];
    fromLocal: number;
    fetched: number;
    missing: string[];
    sourceUsed: AbstractSource;
}
export declare function fetchedAbstractsPath(): string;
/** Load PMID list from CSV (PMID column) or plain newline-separated file. */
export declare function loadPmidListFromFile(path: string): string[];
/**
 * Resolve abstracts for an explicit PMID list.
 * Local `data/abstracts/*.csv` wins; missing ones are fetched and optionally cached.
 */
export declare function resolveAbstractsForPmids(pmids: string[], options?: ResolveAbstractsOptions): Promise<ResolveAbstractsResult>;
