/**
 * PhosphoSitePlus / supplementary tables:
 * "GENE_S5731", "P04637_S15", "1433S_S74__1", "CIC-S739", "MAPK1-T185,Y187".
 */
export declare function isValidUniprotAccession(id: string): boolean;
export interface PhosphositeCombinedId {
    geneOrAcc: string;
    aminoAcid: string;
    position: string;
    isUniprotAcc: boolean;
}
/**
 * Parse PSP / table combined IDs.
 * Accepts underscore or hyphen between gene/accession and residue:
 *   GENE_S5731, CIC-S739, P04637_S15
 * Multi-site cells (MAPK1-T185,Y187) → first site only; use
 * parseAllPhosphositeCombinedIds to expand.
 */
export declare function parsePhosphositeCombinedId(raw: string): PhosphositeCombinedId | null;
/** Expand multi-site cells into one hit per residue (same gene/accession). */
export declare function parseAllPhosphositeCombinedIds(raw: string): PhosphositeCombinedId[];
/** True when a cell looks like gene/acc + residue (including multi-site). */
export declare function looksLikePhosphositeCombinedId(raw: string): boolean;
