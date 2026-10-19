import type { AbstractRecord, LiteratureInfoRow, ScreenDecision, ScreenResult } from "../types.js";
/** Project root = CollectionAgent/ */
export declare function projectRoot(): string;
/** Default pipeline data root: `<project>/data` */
export declare function defaultDataRoot(): string;
export declare function setDataRoot(root: string | null | undefined): string;
export declare function dataRoot(): string;
export declare function isCustomDataRoot(): boolean;
export declare function abstractsDir(): string;
export declare function literatureInfoPath(): string;
/** Store paths relative to project root when possible (portable across machines). */
export declare function toPortablePath(absPath: string): string;
/** Resolve a path stored in JSON/CSV (relative to project root or absolute legacy). */
export declare function resolvePortablePath(stored: string): string;
export declare function stage1Dir(): string;
/** @deprecated use stage1Dir() */
export declare function screenedDir(): string;
export declare function stage2Dir(): string;
export declare function stage2ManifestJsonlPath(): string;
export declare function stage2ResultsCsvPath(): string;
export declare function stage2ManualQueuePath(): string;
export declare function stage2FulltextDir(): string;
export declare function stage2FulltextManifestPath(): string;
export declare function stage2FulltextResultsCsvPath(): string;
export declare function stage2FulltextManualQueuePath(): string;
export declare function stage3Dir(): string;
export declare function stage3ResultsJsonlPath(): string;
export declare function stage3ResultsCsvPath(): string;
/** Canonical literature_info export (aligned with files/qPTM3_109pmids.csv columns) */
export declare function stage3LiteratureInfoPath(): string;
export declare function stage3ManualQueuePath(): string;
export declare function stage4Dir(): string;
export declare function stage4SuppDir(): string;
export declare function stage4SuppScoutJsonlPath(): string;
export declare function stage4SuppScoutCsvPath(): string;
export declare function stage4SuppJobsPath(): string;
export declare function stage4ManualQueuePath(): string;
export declare function stage5Dir(): string;
export declare function stage5InventoryDir(): string;
export declare function stage5WorkDir(): string;
export declare function stage5ResultsJsonlPath(): string;
export declare function stage5QratioCsvPath(): string;
export declare function stage5ProteomeCsvPath(): string;
export declare function stage5ParseReportPath(): string;
export declare function stage5ManualQueuePath(): string;
/** Papers that successfully entered qratio (status=ok, rowCount>0) */
export declare function stage5QratioSuccessPath(): string;
export declare function stage5QcResultsPath(): string;
export declare function stage5IntensityQueuePath(): string;
export declare function writeCsvRows(path: string, rows: string[][]): void;
/** Keep one row per PMID; last row wins unless preferLatestColumn is set (lexicographic compare). */
export declare function dedupeCsvFileByPmid(path: string, opts?: {
    preferLatestColumn?: string;
}): {
    before: number;
    after: number;
    removed: number;
};
export declare function stage6Dir(): string;
export declare function stage6CacheDir(): string;
export declare function stage6UrlsDir(): string;
export declare function stage6ResultsJsonlPath(): string;
export declare function stage6DownloadJobsPath(): string;
export declare function stage6UrlsAllPath(): string;
export interface QratioSuccessRow {
    pmid: string;
    title: string;
    status: string;
    rowCount: number;
    proteomeRowCount: number;
}
export declare function loadQratioSuccessCsv(path?: string): QratioSuccessRow[];
export interface LiteratureInfoCsvRow {
    pmid: string;
    title: string;
    organism: string;
    ptms: string;
    msDataSource: string;
    identifier: string;
}
/** Load canonical Stage3 literature_info.csv (subset of columns used by Stage6). */
export declare function loadLiteratureInfoCsv(path?: string): LiteratureInfoCsvRow[];
export declare function includePmidsCsvPath(): string;
export declare function resultsJsonlPath(): string;
export declare function resultsCsvPath(): string;
/** Decode buffer: UTF-8 first, then gb18030 for PubMed CN exports */
export declare function decodeBuffer(buf: Buffer): string;
export declare function readTextFile(path: string): string;
/** Minimal CSV parser supporting quoted fields with commas/newlines */
export declare function parseCsv(text: string): string[][];
export declare function parseAbstractCsv(text: string, sourceFile: string): AbstractRecord[];
export declare function loadGoldPmids(): Set<string>;
export declare function loadAllAbstracts(): AbstractRecord[];
export declare function loadScreenedPmids(): Set<string>;
export declare function loadAllScreenResults(): ScreenResult[];
export declare function appendScreenResults(results: ScreenResult[]): void;
export declare function writeAllScreenResults(results: ScreenResult[]): void;
/** Drop prior Stage-1 decisions for the given PMIDs (for --rescreen). */
export declare function removeScreenResultsForPmids(pmids: Iterable<string>, options?: {
    refreshExports?: boolean;
}): number;
export interface ManualReviewRow {
    pmid: string;
    decision: ScreenDecision;
    note?: string;
}
/** Parse PMID,decision[,note] CSV from manual review */
export declare function parseManualReviewCsv(text: string): ManualReviewRow[];
export declare function applyManualReviews(reviews: ManualReviewRow[]): {
    updated: number;
    missing: string[];
};
export declare function exportIncludePmidsCsv(): number;
/**
 * Write Stage-2 input include list from abstracts (bypass ScreenChain).
 * Include CSV is exactly `records` (for validation Stage2–5).
 * Also upserts stage1_results as include with a force-include reason.
 */
export declare function writeForceIncludeFromAbstracts(records: AbstractRecord[], opts?: {
    reason?: string;
}): {
    includeN: number;
    path: string;
};
/** Stage 2 input: self-contained include list (includes Abstract). */
export interface IncludePmidRow {
    pmid: string;
    title: string;
    abstract: string;
    confidence: number;
    dataSourceHint: string;
    reason: string;
    sourceFile: string;
}
export declare function loadIncludePmidsCsv(path?: string): IncludePmidRow[];
export declare function exportUncertainPmidsCsv(): number;
export declare function rebuildResultsCsv(): void;
export declare function csvEscape(v: string): string;
export declare function loadStage3Results(): LiteratureInfoRow[];
/** PMIDs with a successful Stage3 extraction (errors remain retriable). */
export declare function loadStage3DonePmids(): Set<string>;
/** Latest Stage3 result for one PMID (includes error shells). */
export declare function loadStage3ResultForPmid(pmid: string): LiteratureInfoRow | null;
/** Map LiteratureInfoRow → UI / literature_info column names. */
export declare function literatureInfoToDisplayRow(r: LiteratureInfoRow): Record<string, string>;
export declare function appendStage3Results(rows: LiteratureInfoRow[]): void;
/** Rebuild CSV + literature_info + manual queue from full JSONL. */
export declare function rebuildStage3Outputs(): void;
export declare function computeStats(): {
    totalAbstracts: number;
    uniquePmids: number;
    alreadyScreened: number;
    pending: number;
    include: number;
    exclude: number;
    uncertain: number;
    goldOverlapPending: number;
};
