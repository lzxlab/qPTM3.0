/**
 * User-guided derived ratios from per-sample intensity / quantitation channels.
 * Example note: "log2(P5/P1), log2(P7/P5), log2(P7/P1)"
 */
import type { ColumnMapping } from "./heuristic.js";
export interface DerivedRatioSpec {
    /** Channel / sample label on the left of the contrast (e.g. P5). */
    numerator: string;
    /** Channel / sample label on the right (e.g. P1). */
    denominator: string;
    /** When true, store log2(num/den); otherwise fold-change num/den. */
    isLog2: boolean;
    /** Condition label written to qratio rows. */
    condition: string;
}
export interface DerivedIntensityContrast {
    condition: string;
    numeratorCol: string;
    denominatorCol: string;
    isLog2: boolean;
    level: "peptide" | "protein";
}
/** Parse contrast formulas from Teach / chat guidance. */
export declare function parseDerivedRatioSpecs(note: string | undefined | null): DerivedRatioSpec[];
/**
 * Score how well a header matches a bare channel label (P5, Day1, …).
 * Prefer site-level quantitation over protein-level when both exist.
 */
export declare function scoreChannelHeader(header: string, channel: string): number;
/** Pick best header for a channel label. */
export declare function resolveChannelColumn(headers: string[], channel: string, opts?: {
    preferProtein?: boolean;
}): string | null;
export declare function buildDerivedIntensityContrasts(headers: string[], specs: DerivedRatioSpec[]): DerivedIntensityContrast[];
/**
 * When user asks for log2(A/B) on an intensity-only sheet, attach derived contrasts
 * and clear intensityOnly so Stage5 can parse.
 */
export declare function applyDerivedRatiosToMapping(mapping: ColumnMapping, headers: string[], specs: DerivedRatioSpec[]): ColumnMapping;
/** log2(num/den) or num/den from linear intensities. */
export declare function derivedIntensityLog2Fc(numerator: number, denominator: number, isLog2: boolean): number | null;
