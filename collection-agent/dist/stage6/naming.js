/** Short organism tag for download URL filenames (human, mouse, rat, …). */
export function shortOrganism(organism) {
    const parts = organism
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0)
        return "unknown";
    const tags = [...new Set(parts.map(shortOneOrganism))];
    return tags.join("+");
}
function shortOneOrganism(organism) {
    const paren = organism.match(/\(([^)]+)\)/)?.[1]?.trim().toLowerCase();
    if (paren) {
        const fromParen = mapOrganismToken(paren);
        if (fromParen)
            return fromParen;
    }
    return mapOrganismToken(organism.toLowerCase()) ?? slugOrganism(organism);
}
function mapOrganismToken(token) {
    const t = token.toLowerCase();
    if (/\bhuman\b|homo sapiens/.test(t))
        return "human";
    if (/\bmouse\b|mus musculus/.test(t))
        return "mouse";
    if (/\brat\b|rattus/.test(t))
        return "rat";
    if (/\byeast\b|saccharomyces/.test(t))
        return "yeast";
    if (/\bzebrafish\b|danio/.test(t))
        return "zebrafish";
    if (/\barabidopsis\b/.test(t))
        return "arabidopsis";
    return undefined;
}
function slugOrganism(organism) {
    const word = organism
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 12);
    return word || "unknown";
}
const PTM_CODES = [
    { re: /lactyl/i, code: "lact" },
    { re: /phosph/i, code: "phos" },
    { re: /acetyl/i, code: "ace" },
    { re: /ubiquit/i, code: "ubi" },
    { re: /succinyl/i, code: "succ" },
    { re: /crotonyl/i, code: "crot" },
    { re: /glycosyl/i, code: "gly" },
    { re: /methyl/i, code: "meth" },
    { re: /sumoyl/i, code: "sumo" },
    { re: /nitrosyl/i, code: "nitro" },
    { re: /palmitoyl/i, code: "palm" },
    { re: /hydroxybutyryl/i, code: "bhb" },
    { re: /malonyl/i, code: "mal" },
    { re: /glutaryl/i, code: "glut" },
    { re: /propionyl/i, code: "prop" },
    { re: /formyl/i, code: "form" },
    { re: /citrull/i, code: "cit" },
    { re: /proteome|^pro$/i, code: "pro" },
];
/** Short PTM tag for download URL filenames (phos, ace, lact, …).
 * Always one tag — qPTM Modification is a single type per quantitative table. */
export function shortModification(ptms) {
    const parts = ptms
        .split(/[;,|/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0)
        return "unknown";
    return shortOneModification(parts[0]);
}
function shortOneModification(ptm) {
    for (const { re, code } of PTM_CODES) {
        if (re.test(ptm))
            return code;
    }
    const word = ptm.toLowerCase().replace(/[^a-z]/g, "");
    return word.slice(0, 4) || "unk";
}
/** `{pmid}#{accession}#{organism}#{modification}.txt` — pmid is "-" when unknown. */
export function stage6UrlsBasename(pmid, accession, organism, modification) {
    const p = pmidForFilename(pmid);
    return `${p}#${accession}#${organism}#${modification}.txt`;
}
/**
 * PubMed IDs are numeric (typically 5–9 digits).
 * Accessions (PXD… / IPX… / …) must never be written into a PMID column.
 */
export function isRealPmid(value) {
    return /^\d{5,9}$/.test(String(value || "").trim());
}
/** CSV / display PMID: real PubMed ID, or empty when unknown / accession-only. */
export function pmidForOutput(value) {
    const v = String(value || "").trim();
    return isRealPmid(v) ? v : "";
}
/** Filename segment: real PMID, or "-" when resolving by accession only. */
export function pmidForFilename(value) {
    return pmidForOutput(value) || "-";
}
