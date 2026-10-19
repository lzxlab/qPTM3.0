export interface EuropePmcMeta {
    pmid: string;
    doi: string | null;
    pmcid: string | null;
    isOpenAccess: boolean;
    title: string | null;
}
export declare function fetchEuropePmcMeta(pmid: string): Promise<EuropePmcMeta>;
/** Full-text JATS XML when OA / PMC available */
export declare function fetchEuropePmcFullTextXml(pmcid: string): Promise<string | null>;
/** Europe PMC PDF render URL (OA articles only typically) */
export declare function europePmcPdfUrl(pmcid: string): string;
/**
 * Download PDF from Europe PMC. Returns null if not a PDF payload
 * (e.g. HTML interstitial / paywall page).
 */
export declare function fetchEuropePmcPdf(pmcid: string): Promise<Buffer | null>;
export type SuppZipFetchStatus = "ok" | "empty" | "not_found" | "error";
export interface SuppZipFetchResult {
    status: SuppZipFetchStatus;
    buffer: Buffer | null;
    contentType: string | null;
    url: string;
    error?: string;
}
/** Europe PMC OA supplementary files ZIP (may include images unless excluded). */
export declare function europePmcSupplementaryUrl(pmcid: string, includeInlineImage?: boolean): string;
/**
 * Download supplementaryFiles ZIP for a PMCID.
 * Returns status empty/not_found when OA package is missing.
 */
export declare function fetchEuropePmcSupplementaryZip(pmcid: string): Promise<SuppZipFetchResult>;
