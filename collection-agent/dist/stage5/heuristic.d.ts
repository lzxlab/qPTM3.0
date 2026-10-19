import type { SheetInventory } from "./tables.js";
export type RatioLevel = "peptide" | "protein";
export type ValueType = "log2_ratio" | "fold_change" | "intensity" | "other";
export interface MappedRatioColumn {
    column: string;
    condition: string;
    /** If false, values are treated as fold-change and converted with log2 */
    isLog2: boolean;
    level: RatioLevel;
    valueType?: ValueType;
}
export interface MappedPValueColumn {
    column: string;
    condition: string;
    level: RatioLevel;
}
export interface ColumnMapping {
    entryPath: string;
    sheetName: string;
    headerRowIndex: number;
    confidence: number;
    source: "heuristic" | "llm";
    uniprotCol: string | null;
    /** Gene symbol / gene name — used when UniProt column is absent */
    geneCol: string | null;
    positionCol: string | null;
    aminoAcidCol: string | null;
    /** Combined site like S123 / T45 / Y89 */
    siteCombinedCol: string | null;
    /**
     * Long-format tables: one ratio column + a column of per-row contrast labels
     * (e.g. headers feature_names|logFC|P.Value|condition with 14 contrasts stacked).
     */
    conditionCol?: string | null;
    /** MaxQuant probability / modified sequence — AA inferred when aminoAcidCol missing */
    modSeqCol: string | null;
    ratioColumns: MappedRatioColumn[];
    pValueColumns: MappedPValueColumn[];
    /** Sheet appears to be intensity/abundance only (no true ratio) */
    intensityOnly?: boolean;
    intensityColumns?: string[];
    /**
     * User-guided contrasts computed from intensity channels
     * (e.g. log2(P5/P1) from columns "… P5" / "… P1").
     */
    derivedContrasts?: Array<{
        condition: string;
        numeratorCol: string;
        denominatorCol: string;
        isLog2: boolean;
        level: RatioLevel;
    }>;
    notes: string;
}
/** Intensity / abundance columns — must NOT be treated as ratios. */
export declare function scoreIntensity(n: string): number;
/**
 * Drop ratioColumns that are actually intensity/abundance/sample channels.
 * Used after heuristic + LLM so bare labels like P1/P5/P7 never become fake log2FC.
 */
export declare function stripIntensityRatioColumns(mapping: ColumnMapping): ColumnMapping;
/** Map ratio/p-value column conditions onto Stage3 Condition / Detail. */
export declare function alignConditionsToStage3(mapping: ColumnMapping, stage3Condition: string, detailCondition?: string): ColumnMapping;
/**
 * Build heuristic mapping for one sheet. confidence in [0,1].
 */
export declare function heuristicMapSheet(entryPath: string, sheet: SheetInventory): ColumnMapping;
/** High enough to parse without LLM */
export declare const HEURISTIC_HIGH = 0.72;
/** Worth attempting parse after LLM fails if still usable */
export declare const HEURISTIC_MIN_PARSE = 0.55;
/** Parsable into qratio with UniProt (or gene→UniProt) + true ratio cols + site signal.
 * A siteCombinedCol that embeds accession/gene + residue (e.g. Q4VWZ5-K81 / GENE_S15)
 * satisfies both ID and site — parse-rows splits it. */
export declare function mappingIsParsable(m: ColumnMapping): boolean;
export declare function mappingNeedsManual(m: ColumnMapping): boolean;
/**
 * Prefer true residue-number columns (e.g. "Protein: Modified lysine") over
 * peptide-span / accession columns that LLMs often mis-map as Position.
 *
 * Also repairs a common phospho layout: columns STY (residue S/T/Y) + AA (site
 * number). Bare "AA" scores as amino-acid by name, but when STY is present AA
 * is the position.
 */
export declare function repairSiteColumnMapping(mapping: ColumnMapping, headers: string[]): ColumnMapping;
/**
 * Apply free-text column role hints (e.g. "column AA is position") onto a mapping.
 */
export declare function applyColumnRoleHints(mapping: ColumnMapping, headers: string[], roles: {
    uniprotCol?: string;
    geneCol?: string;
    positionCol?: string;
    aminoAcidCol?: string;
    siteCombinedCol?: string;
    conditionCol?: string;
} | null | undefined): ColumnMapping;
/**
 * Force user-named columns into the mapping as protein-level ratio / p-value
 * (e.g. hints.proteomeColumns = { ratioCol: "total proteome Log(ASB2/MCS)",
 * pValueCol: "total proteome p-value" }). Users know which columns hold the
 * whole-proteome quantitation; the LLM often drops them, leaving Log2Ratio
 * (protein) empty.
 */
export declare function applyProteomeColumnHints(mapping: ColumnMapping, headers: string[], hints: {
    proteomeColumns?: {
        ratioCol?: string;
        pValueCol?: string;
    };
} | null | undefined): ColumnMapping;
