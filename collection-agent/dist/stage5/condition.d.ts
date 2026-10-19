/**
 * Align Stage5 Condition labels using Stage3 Condition + Detail condition.
 *
 * Rules:
 * - Cryptic table/sheet labels ("Is 6 h vs. sham", "B4/B1") → match onto
 *   richer Stage3 fragments or phrases mined from Detail condition
 *   (e.g. "6 h cerebral ischemia/Sham").
 * - Fine-grained table labels (MI_30/SHAM) that add timepoints beyond Stage3
 *   → keep the table label.
 * - Generic / SILAC channel headers → Stage3 (or detail-derived) candidates.
 */
/**
 * MaxQuant-style SILAC headers: "Ratio H/L …", "Ratio M/L …" (linear H/L ratio, not log2FC).
 */
export declare function isSilacChannelRatioHeader(h: string): boolean;
/** Biology suffix after SILAC channel ratio, e.g. "WT_10min" from "Ratio H/L normalized WT_10min". */
export declare function silacBiologySuffixFromHeader(h: string): string;
export declare function formatSilacBiologyLabel(suffix: string): string;
/** Treatment token from sheet titles like "Table S2_ETO" / "S3_HU". */
export declare function treatmentTokenFromSheet(sheetName: string): string;
/**
 * Turn spreadsheet arms like "30min_CNT" / "ETO 30min_Ctr" into Stage3-ish
 * "ETO 30 min/Ctr" when the sheet name (or label itself) carries the treatment.
 */
export declare function enrichTimeVsControlLabel(base: string, sheetName?: string): string;
/** Condition label from a ratio column header (shared by heuristic + proteome). */
export declare function conditionLabelFromRatioHeader(h: string, sheetName?: string): string;
export declare function isChannelLabel(cond: string): boolean;
/**
 * Generic spreadsheet headers that are NOT biological conditions
 * (e.g. "(Fold Change)", "Log2Ratio", "FC", "Ratio").
 */
export declare function isGenericRatioLabel(cond: string): boolean;
/**
 * MaxQuant / spreadsheet technical ratio labels (not biological treatment contrasts).
 * e.g. "mod/base", "modified/unmodified", "label/parent".
 */
export declare function isTechnicalRatioLabel(cond: string): boolean;
/**
 * Spreadsheet placeholder contrasts (A/B, AvsB, Group1/Group2) that carry no biology —
 * replace with Stage3 Condition when available.
 */
export declare function isPlaceholderGroupLabel(cond: string): boolean;
/**
 * UniProt FASTA headers / protein-description blobs mistaken for contrast labels.
 * These must fall back to Stage3 Condition (global study contrast), not become qratio.Condition.
 */
export declare function isAnnotationMasqueradingAsCondition(cond: string): boolean;
/**
 * Excel sheet titles that encode a real contrast (e.g. "HOM-VEH vs WT-VEH").
 * Distinct from placeholder "A vs B" labels — these should become qratio.Condition.
 */
export declare function isSheetContrastLabel(cond: string): boolean;
/** Sheet / batch style labels that should be expanded via Detail condition. */
export declare function isCrypticCondition(cond: string): boolean;
/** Strip trailing Ratio / P value noise from column-derived labels. */
export declare function cleanMappedCondition(mapped: string): string;
/**
 * Canonical key so near-duplicate labels collapse:
 * "ETO 30 min/Ctr" ≡ "ETO 30min_Ctr" ≡ "ETO_30min_CNT".
 */
export declare function canonicalizeConditionKey(cond: string): string;
/** Token overlap score between a table-derived label and a Stage3 comparison fragment. */
export declare function biologicalConditionOverlap(mapped: string, stage3Part: string): number;
/**
 * True when spreadsheet label carries extra biological detail beyond Stage3
 * (timepoints, doses, sub-comparisons like MI_6h/MI_30).
 */
export declare function hasExtraSpecificity(mapped: string, stage3Part: string): boolean;
/**
 * Mine compact Treatment/Baseline comparisons from Detail condition prose.
 * Example: "...mice after 6 h of cerebral ischemia, and mice after 1.5 h of
 * ischemia and 24 h of reperfusion..." + sham →
 * ["6 h cerebral ischemia/Sham", "1.5 h ischemia + 24 h reperfusion/Sham"]
 */
export declare function extractComparisonsFromDetail(detailCondition: string): string[];
/**
 * Mine timepoint contrasts from prose like "treated with 2 mM H2O2 for 0.5, 1, 2, and 4 hours".
 */
export declare function extractTimepointComparisonsFromDetail(detailCondition: string): string[];
/** Stage3 Condition parts that look biologically informative (not sheet-name residue). */
export declare function informativeStage3Parts(stage3Condition: string): string[];
/** Candidates for alignment: informative Stage3 fragments + Detail-mined comparisons. */
export declare function conditionCandidates(stage3Condition: string, detailCondition?: string): string[];
/** Pick best candidate label for a mapped spreadsheet condition. */
export declare function matchStage3Condition(mapped: string, stage3Condition: string, detailCondition?: string): string | null;
/**
 * One biological condition per row.
 * Prefer Detail/Stage3-expanded labels over cryptic sheet names; keep finer table ratios.
 */
export declare function resolveRowCondition(mappedCondition: string, stage3Condition: string, detailCondition?: string): string;
