export type FulltextStatus = "ok" | "partial" | "unavailable" | "error";
export interface FulltextInput {
    pmid: string;
    title?: string;
    doi?: string | null;
    pmcid?: string | null;
    isOpenAccess?: boolean;
}
export interface FulltextRecord {
    pmid: string;
    title: string;
    status: FulltextStatus;
    doi: string | null;
    pmcid: string | null;
    hasXml: boolean;
    hasPdf: boolean;
    xmlPath: string | null;
    pdfPath: string | null;
    sources: string[];
    urls: string[];
    notes: string;
    fetchedAt: string;
    error?: string;
}
export declare function fulltextRootDir(): string;
export declare function fulltextPmidDir(pmid: string): string;
/**
 * Cascaded OA fulltext fetch (no paywall bypass):
 * 1) Europe PMC XML + PDF when pmcid present
 * 2) Unpaywall OA PDF by DOI
 * 3) unavailable → manual queue
 */
export declare function fetchFulltextForPmid(input: FulltextInput): Promise<FulltextRecord>;
