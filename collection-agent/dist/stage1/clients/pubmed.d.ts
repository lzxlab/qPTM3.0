export interface PubmedAbstract {
    pmid: string;
    title: string;
    abstract: string;
}
/** Parse PubmedArticleSet XML into title/abstract records. */
export declare function parsePubmedEfetchXml(xml: string): PubmedAbstract[];
/**
 * Batch-fetch title/abstract via efetch.
 * NCBI allows up to ~200 ids per request; we use 100 and pace requests.
 */
export declare function fetchPubmedAbstracts(pmids: string[], opts?: {
    batchSize?: number;
    pauseMs?: number;
}): Promise<Map<string, PubmedAbstract>>;
