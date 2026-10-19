export interface IngestSuppOptions {
    pmid: string;
    /** Single file (legacy). */
    filePath?: string;
    /** Multiple tabular files to pack/merge into one supplementary.zip. */
    filePaths?: string[];
    /** When true (default), merge into an existing user supplementary.zip. */
    merge?: boolean;
}
export interface IngestSuppResult {
    pmid: string;
    zipPath: string;
    listingPath: string;
    fileCount: number;
}
export declare function ingestManualSupplementary(options: IngestSuppOptions): IngestSuppResult;
