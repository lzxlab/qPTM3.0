import { type SuppScoutRecord } from "../pipeline/stage4-supp.js";
import type { ZipFileHit } from "../stage4/supp-scout.js";
export declare function registerManualSuppJob(options: {
    pmid: string;
    title?: string;
    zipHits: ZipFileHit[];
    zipPath: string;
    sourceFile?: string;
}): SuppScoutRecord;
export declare function hasUserUploadedSupplementary(pmid: string): boolean;
