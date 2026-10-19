/**
 * Classify user uploads for collection jobs.
 */
import { extname } from "node:path";
const FULLTEXT_EXT = new Set([".pdf", ".xml"]);
const SUPP_EXT = new Set([".zip", ".xlsx", ".xls", ".csv", ".tsv"]);
export function classifyUploadPath(filePath) {
    const ext = extname(filePath).toLowerCase();
    if (FULLTEXT_EXT.has(ext))
        return "fulltext";
    if (SUPP_EXT.has(ext))
        return "supplementary";
    return "unknown";
}
export function isTabularUpload(filePath) {
    return classifyUploadPath(filePath) === "supplementary";
}
export function isFulltextUpload(filePath) {
    return classifyUploadPath(filePath) === "fulltext";
}
