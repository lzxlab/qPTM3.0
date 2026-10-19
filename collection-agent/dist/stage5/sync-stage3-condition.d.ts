import type { LiteratureInfoRow } from "../types.js";
import type { QratioRow } from "./parse-rows.js";
/** Unique informative conditions in stable lexicographic order. */
export declare function collectConditionsFromQratioRows(rows: QratioRow[]): string[];
export interface Stage3ConditionSyncDecision {
    shouldSync: boolean;
    reason: string;
    informativeDerived: string[];
    after: string;
}
/**
 * Decide whether Stage5-derived conditions should replace Stage3 Condition.
 * Never overwrite informative Stage3 biology with technical sheet headers (mod/base).
 */
export declare function evaluateStage3ConditionSync(existing: LiteratureInfoRow, derived: string[]): Stage3ConditionSyncDecision;
export interface SyncStage3ConditionResult {
    pmid: string;
    updated: boolean;
    before: string;
    after: string;
    reason?: string;
}
/**
 * Replace Stage3 Condition for one PMID with Stage5-derived list.
 * Leaves Detail condition unchanged (narrative context).
 */
export declare function syncStage3ConditionFromQratio(pmid: string, rows: QratioRow[]): SyncStage3ConditionResult;
/** Backfill: rebuild Stage3 Condition from existing qratio_rows.jsonl for ok PMIDs. */
export declare function syncAllStage3ConditionsFromQratioRows(allRows: QratioRow[], okPmids?: Set<string>): SyncStage3ConditionResult[];
