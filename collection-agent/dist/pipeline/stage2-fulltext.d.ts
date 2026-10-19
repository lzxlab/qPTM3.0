import { type FulltextRecord } from "../stage2/fulltext.js";
export declare function writeFulltextOutputs(records: FulltextRecord[]): void;
export interface Stage2FulltextOptions {
    limit?: number;
    all?: boolean;
    concurrency?: number;
    resume?: boolean;
    /** Re-fetch PMIDs previously marked unavailable/error (keeps ok/partial with files) */
    retryUnavailable?: boolean;
    pmid?: string;
    onResult?: (r: FulltextRecord, index: number, total: number) => void;
}
export interface Stage2FulltextSummary {
    attempted: number;
    ok: number;
    partial: number;
    unavailable: number;
    errors: number;
    withXml: number;
    withPdf: number;
}
export declare function runStage2Fulltext(options?: Stage2FulltextOptions): Promise<Stage2FulltextSummary>;
