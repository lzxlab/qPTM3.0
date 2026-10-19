import { type ZipEntry } from "../stage4/zip.js";
export declare const TABLE_EXTS: Set<string>;
/**
 * Resolve a column hint against sheet headers.
 * Supports exact/case-insensitive names and positional aliases from user/LLM
 * hints: `col_1`, `col1`, `column 1`, `column_1` → headers[0].
 */
export declare function resolveColumnIndex(headers: string[], name: string | null | undefined): number;
/** Like resolveColumnIndex, but returns the real header string (or null). */
export declare function resolveColumnName(headers: string[], name: string | null | undefined): string | null;
/** Cap rows loaded for parsing (per sheet). Long-format PTM tables can exceed 100k. */
export declare const MAX_PARSE_ROWS = 600000;
export interface SheetInventory {
    name: string;
    headers: string[];
    preview: string[][];
    /** 0-based index of header row in the raw sheet */
    headerRowIndex: number;
    /** Approximate data rows (excluding header), when known */
    dataRowCount: number;
}
export interface FileInventory {
    entryPath: string;
    localPath: string;
    size: number;
    ext: string;
    sheets: SheetInventory[];
    error?: string;
}
export interface PmidTableInventory {
    pmid: string;
    zipPath: string;
    files: FileInventory[];
    inventoriedAt: string;
}
export declare function pickCandidateEntries(zipPath: string, limit?: number, forceIncludePaths?: string[]): ZipEntry[];
/** Extract selected ZIP entries into destDir (preserves entry relative paths). */
export declare function extractZipEntries(zipPath: string, entryPaths: string[], destDir: string): void;
export declare function inventoryFile(localPath: string, entryPath: string, size: number): FileInventory;
/** Load full sheet rows (header excluded) for parsing. */
export declare function loadSheetData(localPath: string, sheetName: string, maxRows?: number, headerRowIndex?: number): {
    headers: string[];
    rows: string[][];
};
export declare function buildPmidInventory(pmid: string, zipPath: string, workDir: string, forceIncludePaths?: string[]): PmidTableInventory;
export declare function writeInventoryJson(path: string, inv: PmidTableInventory): void;
