import type { Stage5Result } from "../types.js";
export interface Stage5Options {
    limit?: number;
    all?: boolean;
    concurrency?: number;
    flushEvery?: number;
    model?: string;
    pmid?: string;
    /** Default true: only likely_qptm_table */
    likelyOnly?: boolean;
    /** Include has_tabular_supp as well */
    allJobs?: boolean;
    resume?: boolean;
    strictLlm?: boolean;
    onResult?: (row: Stage5Result, index: number, total: number) => void;
    onError?: (pmid: string, error: unknown, index: number) => void;
    /** Live progress for interactive UI (file / sheet / column decisions). */
    onThinking?: (step: Stage5ThinkingStep) => void;
}
export interface Stage5ThinkingStep {
    step: "start" | "inventory" | "candidates" | "sample_from_sheet" | "try_sheet" | "mapping" | "role_hint" | "progress" | "parsed" | "skip" | "summary";
    message: string;
    entryPath?: string;
    sheet?: string;
    kind?: string;
    mappingSource?: string;
    confidence?: number;
    columns?: Record<string, unknown>;
    rowsAdded?: number;
    status?: string;
    at?: string;
}
export interface Stage5RunSummary {
    modelId: string;
    eligible: number;
    attempted: number;
    saved: number;
    skippedDone: number;
    byStatus: Record<string, number>;
    totalRows: number;
    totalProteomeRows: number;
}
/** Rewrite stage5_results.jsonl keeping one row per PMID (latest parsedAt). */
export declare function compactStage5ResultsJsonl(): number;
export interface Stage5PaperCsvDedupeSummary {
    results: number;
    qratioSuccess: {
        before: number;
        after: number;
        removed: number;
    };
    qcResults: {
        before: number;
        after: number;
        removed: number;
    };
    intensityQueue: {
        before: number;
        after: number;
        removed: number;
    };
}
/** Compact jsonl, rebuild derived CSVs, dedupe paper-level exports. */
export declare function finalizeStage5PaperCsvs(): Stage5PaperCsvDedupeSummary;
/**
 * Drop prior qratio rows + Stage5 result for one PMID before a re-parse
 * (hints / free-text guidance), so append does not duplicate.
 */
export declare function clearPmidStage5Data(pmid: string): {
    removedRows: number;
};
/** Stream-rebuild qratio.csv from jsonl (avoids V8 max string length). */
export declare function rebuildQratioCsvFromJsonl(): Promise<number>;
export declare function rebuildStage5Outputs(): void;
export declare function runStage5Parse(options?: Stage5Options): Promise<Stage5RunSummary>;
export declare function stage5OutputPaths(): {
    dir: string;
    results: string;
    qratio: string;
    success: string;
    qcResults: string;
    intensityQueue: string;
    report: string;
    manual: string;
    inventory: string;
};
