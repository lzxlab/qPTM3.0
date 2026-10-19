/**
 * Resolve a single Modification / PTMs value for qratio rows.
 * qPTM schema requires one modification type per quantitative row
 * (never "Phosphorylation; Acetylation").
 */
export const CANONICAL_PTMS = [
    "Lactylation",
    "Phosphorylation",
    "Acetylation",
    "Ubiquitylation",
    "Succinylation",
    "Crotonylation",
    "Glycosylation",
    "Methylation",
    "SUMOylation",
    "Nitrosylation",
    "Palmitoylation",
    "Hydroxybutyrylation",
    "Malonylation",
    "Glutarylation",
    "Propionylation",
    "Formylation",
    "Citrullination",
];
/** Ordered cue → canonical PTM (more specific first). */
const PTM_CUES = [
    { re: /hydroxybutyryl|khib|\bbhb\b/i, ptm: "Hydroxybutyrylation" },
    { re: /lactyl|\bkla\b|k\(la\)/i, ptm: "Lactylation" },
    { re: /phospho|p\-sty|sty\)|tio2|imac|fe\-nta|tio₂/i, ptm: "Phosphorylation" },
    { re: /acetyl|\bkac\b|acetylome/i, ptm: "Acetylation" },
    { re: /ubiquit|glygly|k\-ε\-gg|k\-epsilon\-gg|di\-?gly/i, ptm: "Ubiquitylation" },
    { re: /succinyl/i, ptm: "Succinylation" },
    { re: /crotonyl/i, ptm: "Crotonylation" },
    { re: /malonyl/i, ptm: "Malonylation" },
    { re: /glutaryl/i, ptm: "Glutarylation" },
    { re: /propionyl/i, ptm: "Propionylation" },
    { re: /formyl/i, ptm: "Formylation" },
    { re: /glycosyl|glycoryl|glycoprote|o\-glcnac|n\-glycan|n\-glyc/i, ptm: "Glycosylation" },
    { re: /methyl|\bme[123]\b/i, ptm: "Methylation" },
    { re: /sumoyl|\bsumo\b/i, ptm: "SUMOylation" },
    { re: /nitrosyl|s\-nitroso/i, ptm: "Nitrosylation" },
    { re: /palmitoyl/i, ptm: "Palmitoylation" },
    { re: /citrull/i, ptm: "Citrullination" },
];
export function splitPtms(raw) {
    return (raw || "")
        .split(/[;,|/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}
/** Normalize a free-text PTM token to a canonical qPTM name when possible. */
export function canonicalizePtm(token) {
    const t = (token || "").trim();
    if (!t)
        return "";
    for (const { re, ptm } of PTM_CUES) {
        if (re.test(t))
            return ptm;
    }
    // Already looks like a title-case PTM name
    if (/^[A-Z][A-Za-z0-9+\- ]{2,40}$/.test(t))
        return t;
    return t;
}
/**
 * Infer PTM type from sheet title, column headers, and enrichment method.
 * Returns "" when no clear cue.
 */
export function inferPtmFromSheet(opts) {
    const blobs = [
        opts.sheetName || "",
        ...(opts.headers || []),
        opts.enrichmentMethod || "",
    ];
    for (const blob of blobs) {
        if (!blob)
            continue;
        for (const { re, ptm } of PTM_CUES) {
            if (re.test(blob))
                return ptm;
        }
    }
    return "";
}
/**
 * Pick exactly one Modification value for a quantitative table.
 *
 * Priority:
 * 1. Sheet/header/enrichment cue that matches a Stage3 PTM
 * 2. Sheet/header/enrichment cue alone
 * 3. Single Stage3 PTM
 * 4. First Stage3 PTM (when multiple and no sheet cue)
 */
export function resolveSingleModification(opts) {
    const litParts = splitPtms(opts.litPtms).map(canonicalizePtm).filter(Boolean);
    const uniqueLit = [...new Set(litParts)];
    const inferred = inferPtmFromSheet({
        sheetName: opts.sheetName,
        headers: opts.headers,
        enrichmentMethod: opts.enrichmentMethod,
    });
    if (inferred) {
        const match = uniqueLit.find((p) => p.toLowerCase() === inferred.toLowerCase() || canonicalizePtm(p) === inferred);
        if (match)
            return match;
        return inferred;
    }
    if (uniqueLit.length === 1)
        return uniqueLit[0];
    if (uniqueLit.length > 1)
        return uniqueLit[0];
    return "";
}
