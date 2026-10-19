/**
 * Stage 5 — whole-proteome quantitative tables (protein-level ratios).
 *
 * Hard rule: do NOT treat site-less PTM / modification tables as proteome.
 * Proteome = UniProt/gene + protein abundance ratio/FC, without PTM-site cues.
 */
import type { LiteratureInfoRow } from "../types.js";
import { type MappedPValueColumn, type MappedRatioColumn } from "./heuristic.js";
import { type QratioRow } from "./parse-rows.js";
export type SheetKind = "site_ptm" | "proteome" | "ptm_no_site" | "intensity" | "other";
export interface ProteomeMapping {
    entryPath: string;
    sheetName: string;
    headerRowIndex: number;
    confidence: number;
    uniprotCol: string | null;
    geneCol: string | null;
    ratioColumns: MappedRatioColumn[];
    pValueColumns: MappedPValueColumn[];
    notes: string;
}
export interface ProteomeRow {
    pmid: string;
    sample: string;
    sampleType: string;
    organism: string;
    ptms: string;
    condition: string;
    uniprotId: string;
    log2Ratio: string;
    pValue: string;
    sheetRef: string;
}
export declare const PROTEOME_CSV_HEADER: readonly ["PMID", "Sample", "Sample type", "Organism", "PTMs", "Condition", "UniProtID", "Log2Ratio", "P value", "Sheet"];
/** PTM / modification cues that mean "not whole proteome". */
export declare function hasPtmCues(sheetName: string, headers: string[]): boolean;
export declare function hasSiteColumns(headers: string[]): boolean;
/**
 * Classify a sheet before parsing.
 * ptm_no_site: has PTM cues but no site columns → NEVER treat as proteome.
 */
export declare function classifySheetKind(sheetName: string, headers: string[]): SheetKind;
export declare function heuristicMapProteomeSheet(entryPath: string, sheet: {
    name: string;
    headers: string[];
    headerRowIndex?: number;
}, opts?: {
    force?: boolean;
}): ProteomeMapping | null;
export declare function parseProteomeSheet(opts: {
    localPath: string;
    mapping: ProteomeMapping;
    lit: LiteratureInfoRow;
    fallbackCondition: string;
    maxRows?: number;
    preferSheetAsSample?: boolean;
    /** Skip classifySheetKind===proteome gate (user Teach force). */
    forceProteome?: boolean;
}): Promise<ProteomeRow[]>;
/** Align proteome ratio conditions to Stage3 (reuse site aligner shape). */
export declare function alignProteomeConditions(mapping: ProteomeMapping, stage3Condition: string, detailCondition?: string): ProteomeMapping;
export declare function proteomeToCsvLine(r: ProteomeRow): string;
/**
 * Fill Log2Ratio (protein) / P value (protein) on site-level qratio rows
 * by UniProt (+ Condition when possible).
 * Proteins present only in the proteome table (no site/mod rows) are ignored.
 */
export declare function enrichSiteRowsWithProteome(siteRows: QratioRow[], proteomeRows: ProteomeRow[]): {
    filled: number;
    matchedProteins: number;
};
