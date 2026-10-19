import type { Stage6AccessionResult, Stage6Result, Stage6Status } from "../types.js";
export interface Stage6Options {
    limit?: number;
    all?: boolean;
    concurrency?: number;
    pmid?: string;
    resume?: boolean;
    rawOnly?: boolean;
    getUrlDir?: string;
    onResult?: (row: Stage6Result, index: number, total: number) => void;
    onError?: (pmid: string, error: unknown, index: number) => void;
}
export interface Stage6RunSummary {
    eligible: number;
    attempted: number;
    saved: number;
    skippedDone: number;
    byStatus: Record<Stage6Status, number>;
    totalUrls: number;
    totalRawUrls: number;
    uniqueAccessions: number;
}
/** Paper-level Stage6 status: ok when any repo yields download URLs. */
export declare function aggregateStage6Status(accessions: Stage6AccessionResult[]): Stage6Status;
export declare function processPaper(pmid: string, title: string, organismRaw: string, ptmsRaw: string, msDataSource: string, identifier: string, getUrlDir: string | undefined): Promise<Stage6Result>;
export declare function runStage6DownloadUrls(options?: Stage6Options): Promise<Stage6RunSummary>;
export declare function stage6OutputPaths(): {
    dir: string;
    results: string;
    jobs: string;
    urlsAll: string;
    urlsDir: string;
    cache: string;
};
export interface ResolveUrlsOptions {
    accessions: string[];
    /** Real PubMed ID when known. Never pass an accession here. */
    pmid?: string;
    title?: string;
    organism?: string;
    modification?: string;
    msDataSource?: string;
    getUrlDir?: string;
    onLog?: (msg: string) => void;
}
export interface ResolveUrlsSummary extends Stage6RunSummary {
    accessions: string[];
    results: Stage6Result[];
    urlsPath: string;
}
/**
 * Standalone Stage-6 URL resolution for one or more MS accessions
 * (PXD / IPX / JPST / MSV / PDC) without a full PMID pipeline.
 */
export declare function runResolveUrlsByAccession(options: ResolveUrlsOptions): Promise<ResolveUrlsSummary>;
