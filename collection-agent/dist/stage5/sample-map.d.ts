/**
 * Map Stage3 Condition labels → Sample for qratio rows.
 *
 * Map string format (from Stage3 / literature_info):
 *   "HCC/Normal=>HCC tissue; Lung metastasis/Normal=>lung metastasis tissue"
 */
/** Parse "Cond=>Sample; Cond2=>Sample2" (also accepts "Cond=Sample").
 * If the same condition is mapped to multiple different samples (common when
 * Stage3 lists N cell lines that share one contrast), drop that key — Sample
 * must then come from the sheet / table context, not the condition map.
 */
export declare function parseConditionSampleMap(raw: string): Map<string, string>;
export declare function lookupConditionSample(mapRaw: string | undefined, condition: string): string;
/**
 * Infer focal sample for a comparison condition (Treatment/Control).
 * Uses the numerator (left of "/") as the primary sample when possible.
 */
export declare function inferSampleFromCondition(stage3Sample: string, condition: string): string;
/**
 * Build Condition=>Sample map from Stage3 Sample + Condition lists.
 * Used when the LLM did not emit an explicit map.
 * Multi-sample + shared condition is left empty (ambiguous) — Stage5 should
 * resolve Sample from per-sample sheets or other table context.
 */
export declare function buildConditionSampleMap(stage3Sample: string, stage3Condition: string, explicitMap?: string): string;
/**
 * True when Excel sheet names clearly correspond to Stage3 Samples
 * (e.g. sheets MCF7 / MDA-MB-231 / MDA-MB-436 with the same Stage3 list).
 */
export declare function sheetsAlignWithStage3Samples(sheetNames: string[], stage3Sample: string): {
    aligned: boolean;
    matchedSamples: string[];
    matchedSheets: string[];
};
/**
 * Resolve Sample for one qratio row.
 */
export declare function resolveRowSample(stage3Sample: string, opts?: {
    tableSample?: string;
    condition?: string;
    conditionSampleMap?: string;
}): string;
/**
 * Map an Excel sheet name to a Stage3 Sample when sheets are per-sample
 * (e.g. sheets MCF7 / MDA-MB-231 / MDA-MB-436).
 */
export declare function resolveSheetAsSample(sheetName: string, stage3Sample: string, preferSheetAsSample?: boolean): string;
