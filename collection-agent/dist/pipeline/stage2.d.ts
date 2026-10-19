import type { Stage2Manifest } from "../stage2/discover.js";
export interface Stage2IncludeRow {
    pmid: string;
    title: string;
    reason: string;
    dataSourceHint: string;
    abstract: string;
}
/** Stage 2 reads only stage1_include_pmids.csv (self-contained, includes Abstract). */
export declare function loadStage2Inputs(): Stage2IncludeRow[];
/**
 * Stratified pilot sample:
 * - up to n/3 proteomexchange
 * - up to n/3 supplementary
 * - rest main_text/unknown (prefer those with accession-like text)
 */
export declare function pickPilotSample(all: Stage2IncludeRow[], n: number): Stage2IncludeRow[];
export declare function writeStage2Outputs(manifests: Stage2Manifest[]): void;
export declare function appendStage2Manifest(m: Stage2Manifest): void;
export interface Stage2Options {
    limit?: number;
    all?: boolean;
    pilot?: boolean;
    concurrency?: number;
    resume?: boolean;
    pmid?: string;
    onResult?: (m: Stage2Manifest, index: number, total: number) => void;
}
export interface Stage2RunSummary {
    attempted: number;
    found: number;
    notFound: number;
    errors: number;
    needsPdf: number;
    channelCounts: Record<string, number>;
}
export declare function runStage2Discover(options?: Stage2Options): Promise<Stage2RunSummary>;
