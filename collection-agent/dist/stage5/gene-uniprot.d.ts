export declare function organismToTaxId(organism: string): number | null;
export declare function normalizeGeneSymbol(raw: string): string;
/**
 * Map unique gene symbols → UniProt accessions for a given organism string.
 * Unmapped genes are omitted from the returned Map.
 */
export declare function mapGenesToUniprot(genes: string[], organism: string, opts?: {
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
}): Promise<Map<string, string>>;
