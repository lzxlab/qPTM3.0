/**
 * User-facing messages for the interactive collection job (default: English).
 *
 * UI segment markers (<<<…>>>) are stripped before display; the frontend uses
 * them to interleave prose with previews / forms / action buttons.
 */
export const UI_SEG = {
    AFTER_PAPER: "<<<AFTER_PAPER>>>",
    AFTER_META: "<<<AFTER_META>>>",
    AFTER_SCOUT: "<<<AFTER_SCOUT>>>",
    AFTER_QRATIO: "<<<AFTER_QRATIO>>>",
    AFTER_ADJUST: "<<<AFTER_ADJUST>>>",
    AFTER_CONTRIBUTE: "<<<AFTER_CONTRIBUTE>>>",
};
export function messageRejected(opts) {
    return [
        "After screening, this paper does not appear to contain quantitative post-translational modification (PTM) proteomics data, so it cannot enter the qPTM collection pipeline.",
        "",
        UI_SEG.AFTER_PAPER,
        "qPTM mainly curates site-level quantitative PTM mass-spectrometry results.",
        "If you still want to collect data from this paper, click Include to continue anyway.",
    ].join("\n");
}
export function messageUncertain(opts) {
    const conf = opts.confidence != null && Number.isFinite(opts.confidence)
        ? ` (confidence ${Math.round(opts.confidence * 100)}%)`
        : "";
    const lines = [
        `Screening is uncertain${conf}: we cannot fully confirm site-level quantitative PTM data.`,
    ];
    if (opts.reason)
        lines.push(`Note: ${opts.reason}`);
    lines.push("", "If you know the paper contains quantitative PTM tables, click Continue to proceed; otherwise try another PMID or upload a clearer supplementary table.");
    return lines.join("\n");
}
export function messageInclude(opts) {
    const lines = [
        "This paper appears to contain quantitative PTM proteomics data and is suitable for the qPTM collection pipeline.",
    ];
    if (opts.ptmTypes && opts.ptmTypes.length) {
        lines.push(`Detected PTM types: ${opts.ptmTypes.join(", ")}.`);
    }
    lines.push("");
    lines.push(UI_SEG.AFTER_PAPER);
    if (opts.hasFulltext) {
        lines.push("Click Continue to extract experimental information.");
    }
    else {
        lines.push("Click Continue to fetch the full text (PDF/XML). Next we will extract experimental information.");
    }
    return lines.join("\n");
}
export function messageFulltextMissing() {
    return [
        "Open-access full text could not be retrieved automatically.",
        "Common causes: the journal is not OA, publisher blocking, or no usable Unpaywall/PMC link.",
        "",
        "Please upload a PDF or JATS XML for this paper, then click Continue.",
        "After upload we will extract Sample / Condition / PTMs and related metadata.",
    ].join("\n");
}
export function messageFulltextOk(source) {
    return source === "upload"
        ? "Full text is ready, then click Continue to extract literature metadata."
        : "Full text retrieved successfully, then click Continue to extract literature metadata.";
}
export function messageSuppMissing() {
    return [
        "Supplementary quantitative tables could not be downloaded automatically.",
        "Common causes: login-walled supplements, broken links, or tables only in the main text / attached files.",
        "",
        "Please upload a ZIP / Excel / CSV / TSV with site-level quant data, then click Continue.",
        "Ideal columns: UniProt (or gene), PTM site, and ratio / Log2Ratio.",
    ].join("\n");
}
export function messageMetaFailed(opts) {
    const lines = [
        "Experimental metadata extraction failed, so Sample / Organism / PTMs could not be filled.",
    ];
    const err = (opts?.error || "").trim();
    if (err)
        lines.push(`Note: ${err}`);
    lines.push("", UI_SEG.AFTER_META, "Click Continue to retry metadata extraction from the full text.", "Without this step, quantitative rows would be missing Sample / Organism / PTMs.");
    return lines.join("\n");
}
export function messageSuppOk() {
    return [
        "Supplementary quantitative tables located.",
        "",
        UI_SEG.AFTER_SCOUT,
        "Click Continue to parse quantitative data.",
    ].join("\n");
}
export function messageParseEmpty(opts) {
    const lines = [
        "The supplementary tables were read, but no site-level quantitative PTM ratios were parsed (0 qratio rows).",
        "Review the parse log below, then either:",
        "• Select which file/sheet contains the site-level quant table and click “Use selected tables”, or",
        "• Upload a clearer ZIP / Excel / CSV and try again.",
        "Ideal columns: UniProt (or gene), PTM site, and ratio / Log2Ratio.",
    ];
    if (opts?.canSkipToMsUrls) {
        const id = (opts.identifier || "").trim();
        lines.push("", id
            ? `A MS repository accession was already found (${id}).`
            : "A MS repository accession was already found in the literature metadata.", "You can also click Continue to resolve MS repository download URLs (PRIDE / iProX / jPOST / CPTAC) without quantitative rows.");
    }
    return lines.join("\n");
}
export function messageUserSuppReady() {
    return [
        "User-uploaded supplementary tables detected.",
        "",
        UI_SEG.AFTER_SCOUT,
        "Click Continue to parse quantitative data.",
    ].join("\n");
}
export function messageParseOk(rowCount, opts) {
    const lines = [];
    if (opts?.sheetsUsed) {
        // Strip "#SheetName" suffixes, dedupe, and keep the real filename (with extension).
        const siteSheets = [...new Set(opts.sheetsUsed
                .split(";")
                .map(s => s.split("#")[0].trim())
                .filter(Boolean))];
        lines.push(`Site-level quantitative data extracted from: ${siteSheets.join(", ")}.`);
    }
    if (opts?.proteinFilled && opts.proteinFilled > 0) {
        lines.push(`Protein-level Log2Ratio was joined onto ${opts.proteinFilled} site row(s) where UniProt IDs matched.`);
    }
    lines.push(`Quantitative tables parsed: ${rowCount} site-level record(s) written to Quantitative_data.csv.`);
    lines.push("", UI_SEG.AFTER_QRATIO, "If something looks wrong (missing file, Condition mismatch, empty Log2Ratio (protein)), tell me in chat — e.g. which Excel file/sheet to use — or use “Adjust tables” below to re-parse.", "", UI_SEG.AFTER_ADJUST, "If you are willing, you can contribute these curated results to the qPTM database.", "", UI_SEG.AFTER_CONTRIBUTE, "You can also click Continue to resolve MS repository download URLs (PRIDE / iProX / jPOST / CPTAC).");
    return lines.join("\n");
}
export function messageMsUrlsComplete(opts) {
    const lines = ["MS repository download links have been resolved."];
    if (opts.missingIdentifier) {
        lines.push("No MS repository accession (PXD / IPX / MSV / JPST / PDC) was found in the literature metadata, so no download URLs could be resolved.");
    }
    else if (opts.totalUrls != null && Number.isFinite(opts.totalUrls)) {
        lines.push(`Found ${opts.totalUrls} download URL(s).`);
    }
    if (opts.statusNote)
        lines.push(opts.statusNote);
    return lines.join("\n");
}
export function messageComplete(rowCount) {
    return [
        "Collection complete. You can download Experimental_info.csv and Quantitative_data.csv below.",
        "",
        "If you are willing, you can contribute these curated results to the qPTM database to help other researchers.",
    ].join("\n");
}
export function messageCompleteNoContribute(rowCount) {
    return `Collection complete: parsed ${rowCount} site-level quantitative record(s). You can download the CSV files below.`;
}
