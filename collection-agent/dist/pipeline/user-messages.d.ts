/**
 * User-facing messages for the interactive collection job (default: English).
 *
 * UI segment markers (<<<…>>>) are stripped before display; the frontend uses
 * them to interleave prose with previews / forms / action buttons.
 */
export declare const UI_SEG: {
    readonly AFTER_PAPER: "<<<AFTER_PAPER>>>";
    readonly AFTER_META: "<<<AFTER_META>>>";
    readonly AFTER_SCOUT: "<<<AFTER_SCOUT>>>";
    readonly AFTER_QRATIO: "<<<AFTER_QRATIO>>>";
    readonly AFTER_ADJUST: "<<<AFTER_ADJUST>>>";
    readonly AFTER_CONTRIBUTE: "<<<AFTER_CONTRIBUTE>>>";
};
export declare function messageRejected(opts: {
    title?: string;
    reason?: string;
    ptmTypes?: string[];
}): string;
export declare function messageUncertain(opts: {
    title?: string;
    abstract?: string;
    reason?: string;
    confidence?: number;
}): string;
export declare function messageInclude(opts: {
    title?: string;
    abstract?: string;
    ptmTypes?: string[];
    /** True when PDF/XML is already present (e.g. user upload). */
    hasFulltext?: boolean;
}): string;
export declare function messageFulltextMissing(): string;
export declare function messageFulltextOk(source: "upload" | "oa"): string;
export declare function messageSuppMissing(): string;
export declare function messageMetaFailed(opts?: {
    error?: string;
}): string;
export declare function messageSuppOk(): string;
export declare function messageParseEmpty(opts?: {
    /** Stage-3 has a MS accession — user may skip to Stage 6. */
    canSkipToMsUrls?: boolean;
    identifier?: string;
}): string;
export declare function messageUserSuppReady(): string;
export declare function messageParseOk(rowCount: number, opts?: {
    proteinFilled?: number;
    sheetsUsed?: string;
}): string;
export declare function messageMsUrlsComplete(opts: {
    totalUrls?: number;
    statusNote?: string;
    /** Stage-3 Identifier was empty — Stage 6 had nothing to resolve. */
    missingIdentifier?: boolean;
}): string;
export declare function messageComplete(rowCount: number): string;
export declare function messageCompleteNoContribute(rowCount: number): string;
