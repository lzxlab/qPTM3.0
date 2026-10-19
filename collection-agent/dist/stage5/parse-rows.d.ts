/**
 * Stage 5 — turn mapped sheet rows into qratio records.
 */
import type { LiteratureInfoRow } from "../types.js";
import type { ColumnMapping } from "./heuristic.js";
export { resolveRowSample, resolveSheetAsSample } from "./sample-map.js";
export { buildConditionSampleMap, inferSampleFromCondition, lookupConditionSample, parseConditionSampleMap, } from "./sample-map.js";
export interface QratioRow {
    pmid: string;
    sample: string;
    sampleType: string;
    organism: string;
    ptms: string;
    condition: string;
    uniprotId: string;
    position: string;
    aminoAcid: string;
    log2RatioPeptide: string;
    pValuePeptide: string;
    log2RatioProtein: string;
    pValueProtein: string;
}
export declare const QRATIO_CSV_HEADER: readonly ["PMID", "Sample", "Sample type", "Organism", "PTMs", "Condition", "UniProt ID", "Position", "Amino acid", "Log2Ratio (site)", "P value (site)", "Log2Ratio (protein)", "P value (protein)"];
/**
 * Parse a site token like S15 / K374 / Y132*.
 * Never treat a UniProt accession (P32783) or peptide span (P32783 [357-382]) as a site.
 */
export declare function parseSiteToken(text: string): {
    aa: string;
    pos: string;
} | null;
/** True when AA+Position is clearly a mis-parsed UniProt accession. */
export declare function looksLikeUniprotAsSite(uid: string, aa: string, pos: string): boolean;
/** Infer AA from diGly / modification annotations, e.g. `1xGG [K18]` → K. */
export declare function inferAaFromModAnnotation(text: string): string | null;
/** Default residue letter from PTM type / position column name when only a number is known. */
export declare function inferAaFromContext(opts: {
    ptms?: string;
    positionCol?: string | null;
    modAnnotation?: string;
}): string;
/**
 * Infer modified amino acid from MaxQuant-style probability strings, e.g.
 * `PEVSSK(1)GATISK` or `AK(0.998)K(0.002)PAAAAGAK` → K (highest probability).
 */
export declare function inferAaFromModSequence(text: string): string | null;
export declare function parseMappedSheet(opts: {
    localPath: string;
    mapping: ColumnMapping;
    lit: LiteratureInfoRow;
    fallbackCondition: string;
    maxRows?: number;
    /** Precomputed gene→UniProt map (optional; built automatically when geneCol set) */
    geneToUniprot?: Map<string, string>;
    /** Prefer Excel sheet name as the Sample for each row. */
    preferSheetAsSample?: boolean;
    /** Progress while mapping genes / scanning large sheets. */
    onProgress?: (message: string) => void;
}): Promise<QratioRow[]>;
export declare function qratioToCsvLine(r: QratioRow): string;
/**
 * Drop duplicate site-level rows: keep one row per (sample, condition, Modification,
 * UniProt ID, amino acid, position), where "normalized" variants of a condition are
 * merged into the same record. When several ratio columns were mapped onto the same
 * contrast (e.g. "diGly Log(ASB2/MCS)" and "diGly Normalized to Total …"),
 * each previously produced a row — users expect one quantitative record per
 * site per sample per condition per modification. Sample and Modification are part
 * of the key so the same residue measured in different cell lines / tissues, or
 * with different PTMs, is kept separately.
 * Non-empty protein-level fields are merged onto the kept row so no data is
 * lost; the primary (non-normalized) row's values win.
 */
export declare function dedupeQratioRows(rows: QratioRow[]): QratioRow[];
