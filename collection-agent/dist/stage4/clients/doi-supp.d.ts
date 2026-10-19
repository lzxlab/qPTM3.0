export interface DoiSuppFileRef {
    url: string;
    filename: string;
    source: "html" | "guess";
}
export interface DoiSuppFetchResult {
    status: "ok" | "not_found" | "error";
    files: Array<{
        filename: string;
        buffer: Buffer;
        url: string;
    }>;
    landingUrl: string | null;
    error?: string;
    notes: string;
}
export declare function parseSupplementaryLinks(html: string, baseUrl: string): DoiSuppFileRef[];
/**
 * Guess Nature/Springer MOESM URLs from DOI like 10.1038/s41592-022-01523-1.
 * Filenames commonly look like 41592_2022_1523_MOESM1_ESM.xlsx
 */
export declare function guessNatureSpringerEsmUrls(doi: string): DoiSuppFileRef[];
/**
 * Discover + download publisher supplementary tabular files for a DOI.
 */
export declare function fetchDoiSupplementaryFiles(doi: string): Promise<DoiSuppFetchResult>;
/** Pack downloaded files into a ZIP (system `zip`). If a single ZIP already, return it. */
export declare function packSupplementaryZip(outZipPath: string, files: Array<{
    filename: string;
    buffer: Buffer;
}>): void;
