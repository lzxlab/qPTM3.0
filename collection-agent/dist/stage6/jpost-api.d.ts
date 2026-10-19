export interface JpostFileRecord {
    fileId: string;
    fileName: string;
    fileSize?: string;
    fileType?: string;
    projectId?: string;
    location?: string;
    total?: number;
}
export declare function jpostStorageUrl(jpst: string, fileName: string): string;
/** Fetch all files for a JPST accession (paginated /_api/file). */
export declare function jpostFetchAllFiles(jpst: string, opts?: {
    pageSize?: number;
}): Promise<{
    files: JpostFileRecord[];
    urls: string[];
}>;
