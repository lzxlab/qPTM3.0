import type { LiteratureInfoRow, MetaTextSource } from "../../types.js";
export declare class MetaParseError extends Error {
    readonly raw: string;
    constructor(message: string, raw: string);
}
export declare function parseMetaOutput(raw: string, meta: {
    pmid: string;
    title: string;
    textSource: MetaTextSource;
    fallbackIdentifier?: string;
    fallbackMsDataSource?: string;
}): LiteratureInfoRow;
