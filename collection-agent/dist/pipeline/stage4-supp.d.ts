import { type SuppVerdict } from "../stage4/supp-scout.js";
import type { LiteratureInfoRow } from "../types.js";
export type SuppZipStatus = "ok" | "empty" | "not_found" | "error" | "skipped" | "none";
export interface SuppScoutRecord {
    pmid: string;
    title: string;
    /** MS repository accession(s) from Stage 3 — may be empty */
    identifier: string;
    doi: string | null;
    pmcid: string | null;
    verdict: SuppVerdict;
    zipStatus: SuppZipStatus;
    zipPath: string | null;
    topFiles: string;
    clues: string;
    xmlHitCount: number;
    zipHitCount: number;
    notes: string;
    scoutedAt: string;
    error?: string;
}
export interface Stage4SuppOptions {
    limit?: number;
    all?: boolean;
    concurrency?: number;
    flushEvery?: number;
    resume?: boolean;
    pmid?: string;
    /** If true, only papers whose Stage3 Identifier is empty */
    missingIdentifierOnly?: boolean;
    onResult?: (row: SuppScoutRecord, index: number, total: number) => void;
    onError?: (pmid: string, error: unknown, index: number) => void;
}
export interface Stage4SuppSummary {
    eligible: number;
    attempted: number;
    saved: number;
    skippedDone: number;
    byVerdict: Record<string, number>;
}
export declare function rebuildStage4Outputs(): void;
export declare function loadStage4Inputs(options?: {
    pmid?: string;
    missingIdentifierOnly?: boolean;
}): LiteratureInfoRow[];
export declare function runStage4SuppScout(options?: Stage4SuppOptions): Promise<Stage4SuppSummary>;
export declare function stage4OutputPaths(): {
    jsonl: string;
    csv: string;
    jobs: string;
    manual: string;
    suppDir: string;
};
