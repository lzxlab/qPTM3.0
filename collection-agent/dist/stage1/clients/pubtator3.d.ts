import type { PubmedAbstract } from "./pubmed.js";
interface BiocPassage {
    infons?: {
        type?: string;
    };
    text?: string;
}
interface BiocDoc {
    id?: string | number;
    pmid?: string | number;
    passages?: BiocPassage[];
}
interface PubTatorExport {
    PubTator3?: BiocDoc[];
}
export declare function parsePubTatorBiocJson(data: PubTatorExport): PubmedAbstract[];
/**
 * Batch-fetch title/abstract via PubTator3 biocjson export.
 * Keep batches modest; API accepts comma-separated pmids.
 */
export declare function fetchPubTator3Abstracts(pmids: string[], opts?: {
    batchSize?: number;
    pauseMs?: number;
}): Promise<Map<string, PubmedAbstract>>;
export {};
