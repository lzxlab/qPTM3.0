/**
 * Resolve a single Modification / PTMs value for qratio rows.
 * qPTM schema requires one modification type per quantitative row
 * (never "Phosphorylation; Acetylation").
 */
export declare const CANONICAL_PTMS: readonly ["Lactylation", "Phosphorylation", "Acetylation", "Ubiquitylation", "Succinylation", "Crotonylation", "Glycosylation", "Methylation", "SUMOylation", "Nitrosylation", "Palmitoylation", "Hydroxybutyrylation", "Malonylation", "Glutarylation", "Propionylation", "Formylation", "Citrullination"];
export declare function splitPtms(raw: string): string[];
/** Normalize a free-text PTM token to a canonical qPTM name when possible. */
export declare function canonicalizePtm(token: string): string;
/**
 * Infer PTM type from sheet title, column headers, and enrichment method.
 * Returns "" when no clear cue.
 */
export declare function inferPtmFromSheet(opts: {
    sheetName?: string;
    headers?: string[];
    enrichmentMethod?: string;
}): string;
/**
 * Pick exactly one Modification value for a quantitative table.
 *
 * Priority:
 * 1. Sheet/header/enrichment cue that matches a Stage3 PTM
 * 2. Sheet/header/enrichment cue alone
 * 3. Single Stage3 PTM
 * 4. First Stage3 PTM (when multiple and no sheet cue)
 */
export declare function resolveSingleModification(opts: {
    litPtms: string;
    sheetName?: string;
    headers?: string[];
    enrichmentMethod?: string;
}): string;
