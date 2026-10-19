import { type ZipEntry } from "./zip.js";
export type SuppVerdict = "likely_qptm_table" | "has_tabular_supp" | "has_supp_other" | "no_supp" | "unavailable";
export interface XmlSuppHit {
    href: string;
    caption: string;
    score: number;
    clues: string[];
}
export interface ZipFileHit {
    path: string;
    size: number;
    kind: "excel" | "csv" | "tsv" | "pdf" | "doc" | "image" | "other";
    score: number;
    clues: string[];
    headerPreview?: string;
}
export interface XmlSuppScan {
    hits: XmlSuppHit[];
    textClues: string[];
    maxScore: number;
}
export declare function scanLocalXmlSupp(pmid: string): XmlSuppScan;
export declare function scoreZipEntries(zipPath: string, entries: ZipEntry[]): ZipFileHit[];
export declare function decideVerdict(input: {
    hasPmcid: boolean;
    zipStatus: "ok" | "empty" | "not_found" | "error" | "skipped" | "none";
    xml: XmlSuppScan;
    zipHits: ZipFileHit[];
    /** Downloaded via DOI publisher page (non-OA fallback) */
    viaDoi?: boolean;
}): {
    verdict: SuppVerdict;
    notes: string;
};
export declare function listAndScoreZip(zipPath: string): ZipFileHit[];
