/** Short organism tag for download URL filenames (human, mouse, rat, …). */
export declare function shortOrganism(organism: string): string;
/** Short PTM tag for download URL filenames (phos, ace, lact, …).
 * Always one tag — qPTM Modification is a single type per quantitative table. */
export declare function shortModification(ptms: string): string;
/** `{pmid}#{accession}#{organism}#{modification}.txt` — pmid is "-" when unknown. */
export declare function stage6UrlsBasename(pmid: string, accession: string, organism: string, modification: string): string;
/**
 * PubMed IDs are numeric (typically 5–9 digits).
 * Accessions (PXD… / IPX… / …) must never be written into a PMID column.
 */
export declare function isRealPmid(value: string | undefined | null): boolean;
/** CSV / display PMID: real PubMed ID, or empty when unknown / accession-only. */
export declare function pmidForOutput(value: string | undefined | null): string;
/** Filename segment: real PMID, or "-" when resolving by accession only. */
export declare function pmidForFilename(value: string | undefined | null): string;
