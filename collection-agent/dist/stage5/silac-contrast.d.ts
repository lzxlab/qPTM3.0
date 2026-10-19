/**
 * SILAC MaxQuant tables often export per-sample "Ratio H/L genotype_time" columns.
 * Biological contrasts (e.g. ARH3ko vs WT) require pairing columns at the same timepoint:
 *   log2FC = log2( H/L_ko / H/L_wt )
 */
import type { MappedRatioColumn } from "./heuristic.js";
export interface SilacSampleArm {
    /** Raw table suffix, e.g. WT_10min */
    raw: string;
    genotype: string;
    time: string;
}
export interface SilacGenotypeContrast {
    condition: string;
    treat: MappedRatioColumn;
    ref: MappedRatioColumn;
}
/** Parse MaxQuant-style sample suffix "WT_10min" / "ARH3ko_120min". */
export declare function parseSilacSampleArm(suffix: string): SilacSampleArm | null;
/**
 * Pair SILAC ratio columns that share a time suffix into genotype contrasts (treat/ref).
 * Skips when only channel-level H/L labels exist without paired genotypes.
 */
export declare function buildSilacGenotypeContrasts(ratioColumns: MappedRatioColumn[]): SilacGenotypeContrast[];
/** log2( treat_H/L / ref_H/L ) for linear MaxQuant SILAC ratios. */
export declare function silacGenotypeLog2Fc(treatRaw: number, refRaw: number, treatIsLog2: boolean, refIsLog2: boolean): number | null;
export declare function silacContrastFromColumn(col: MappedRatioColumn): string;
