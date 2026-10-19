import type { AbstractRecord, ScreenResult } from "../types.js";
import { type AbstractSource } from "../stage1/resolve-abstracts.js";
export interface Stage1Options {
    /** Max abstracts; omit or Infinity with all=true for full pending set */
    limit?: number;
    all?: boolean;
    /** Only abstracts whose sourceFile contains this substring (e.g. phosphorylation) */
    sourceFile?: string;
    /** Single PMID (auto-fetch abstract if not in local CSVs) */
    pmid?: string;
    /** CSV / plain list of PMIDs (auto-fetch abstracts for missing) */
    pmidsFile?: string;
    /** Abstract API: pubmed | pubtator3 | auto (default auto) */
    abstractSource?: AbstractSource;
    /** Re-screen: drop prior decisions for requested PMIDs before running */
    rescreen?: boolean;
    /** Skip LLM; force all listed PMIDs into stage1_include_pmids.csv */
    forceInclude?: boolean;
    concurrency?: number;
    skipGold?: boolean;
    model?: string;
    /** Checkpoint to disk every N finishes (default 10) */
    flushEvery?: number;
    onResult?: (result: ScreenResult, index: number, total: number) => void;
    onError?: (abstract: AbstractRecord, error: unknown, index: number) => void;
    onLog?: (msg: string) => void;
}
export interface Stage1RunSummary {
    modelId: string;
    attempted: number;
    saved: number;
    errors: number;
    include: number;
    exclude: number;
    uncertain: number;
    pendingAfter: number;
    sourceFileFilter?: string;
    abstractsFromLocal?: number;
    abstractsFetched?: number;
    abstractsMissing?: string[];
}
export interface ForceIncludeSummary {
    requested: number;
    written: number;
    fromLocal: number;
    fetched: number;
    missing: string[];
    includePath: string;
}
/**
 * Bypass ScreenChain: resolve abstracts for PMIDs and write them all as include
 * (for validation / Stage2–5 testing).
 */
export declare function runForceInclude(options?: Stage1Options): Promise<ForceIncludeSummary>;
/**
 * Deterministic Stage-1 orchestrator:
 * for each pending abstract → ScreenChain.run → append results (checkpointed)
 */
export declare function runStage1Screen(options?: Stage1Options): Promise<Stage1RunSummary>;
