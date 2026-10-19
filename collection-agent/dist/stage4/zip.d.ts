export interface ZipEntry {
    path: string;
    size: number;
}
/** `unzip -l` listing (skips directories). */
export declare function listZipEntries(zipPath: string): ZipEntry[];
/** Extract one entry and return its bytes (capped). */
export declare function readZipEntry(zipPath: string, entryPath: string, maxBytes?: number): Buffer | null;
export declare function writeBuffer(path: string, buffer: Buffer): void;
