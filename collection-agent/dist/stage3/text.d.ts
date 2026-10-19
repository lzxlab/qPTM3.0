import type { MetaTextSource } from "../types.js";
export interface FulltextExcerpt {
    textSource: MetaTextSource;
    abstract: string;
    excerpt: string;
    hasXml: boolean;
    hasPdf: boolean;
    notes: string;
}
export declare function loadFulltextExcerpt(pmid: string, abstractFromCsv: string, options?: {
    maxChars?: number;
}): Promise<FulltextExcerpt>;
