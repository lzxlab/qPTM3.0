import type { FulltextRecord } from "../stage2/fulltext.js";
export interface IngestFulltextOptions {
    pmid: string;
    filePath: string;
    title?: string;
    /** Skip Europe PMC DOI/PMCID lookup (tests / offline). Default false. */
    skipIdLookup?: boolean;
}
export declare function ingestManualFulltext(options: IngestFulltextOptions): Promise<FulltextRecord>;
