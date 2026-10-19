export interface UnpaywallHit {
    doi: string;
    isOa: boolean;
    pdfUrl: string | null;
    source: string | null;
    license: string | null;
}
/** Unpaywall requires a contact email in the query string. */
export declare function lookupUnpaywall(doi: string, email: string): Promise<UnpaywallHit>;
