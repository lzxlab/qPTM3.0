import type { LiteratureInfoRow } from "../types.js";
export interface Stage3Options {
    limit?: number;
    all?: boolean;
    concurrency?: number;
    flushEvery?: number;
    model?: string;
    /** Prefer XML-only papers (skip PDF-only abstract fallback) */
    xmlOnly?: boolean;
    pmid?: string;
    onResult?: (row: LiteratureInfoRow, index: number, total: number) => void;
    onError?: (pmid: string, error: unknown, index: number) => void;
    /** Progress callback (step, message) — called at key points during stage 3 execution */
    onProgress?: (step: string, message: string) => void;
}
export interface Stage3RunSummary {
    modelId: string;
    eligible: number;
    attempted: number;
    saved: number;
    errors: number;
    ok: number;
    partial: number;
    skippedDone: number;
}
export interface Stage3Input {
    pmid: string;
    title: string;
    abstract: string;
    hasXml: boolean;
    hasPdf: boolean;
    repositories: Array<{
        id: string;
        source: string;
        via?: string;
    }>;
}
export declare function loadStage3EligibleInputs(options?: {
    xmlOnly?: boolean;
    pmid?: string;
}): Stage3Input[];
/**
 * Stage 3 orchestrator: eligible fulltexts → MetaChain → literature_info.csv
 * Successful (ok/partial) PMIDs in stage3_results.jsonl are skipped; errors are retriable.
 */
export declare function runStage3Meta(options?: Stage3Options): Promise<Stage3RunSummary>;
export declare function stage3OutputPaths(): {
    jsonl: string;
    csv: string;
    literatureInfo: string;
    manual: string;
};
