/**
 * PhosphoSitePlus / supplementary tables:
 * "GENE_S5731", "P04637_S15", "1433S_S74__1", "CIC-S739", "MAPK1-T185,Y187".
 */
const UNIPROT_ACC_RE = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/i;
const AA_RE = /^[ACDEFGHIKLMNPQRSTVWY]$/i;
export function isValidUniprotAccession(id) {
    return UNIPROT_ACC_RE.test((id || "").trim());
}
function makeHit(geneOrAcc, aminoAcid, position) {
    const g = (geneOrAcc || "").trim();
    const aa = (aminoAcid || "").trim().toUpperCase();
    const pos = (position || "").trim();
    if (!g || !AA_RE.test(aa) || !/^\d{1,5}$/.test(pos))
        return null;
    const geneNorm = g.toUpperCase();
    return {
        geneOrAcc: geneNorm,
        aminoAcid: aa,
        position: pos,
        isUniprotAcc: isValidUniprotAccession(geneNorm),
    };
}
/** Parse one site token like "S739" / "T185". */
function parseSiteToken(tok) {
    const m = (tok || "").trim().match(/^([A-Za-z])(\d{1,5})$/);
    if (!m || !AA_RE.test(m[1]))
        return null;
    return { aa: m[1].toUpperCase(), pos: m[2] };
}
/**
 * Parse PSP / table combined IDs.
 * Accepts underscore or hyphen between gene/accession and residue:
 *   GENE_S5731, CIC-S739, P04637_S15
 * Multi-site cells (MAPK1-T185,Y187) → first site only; use
 * parseAllPhosphositeCombinedIds to expand.
 */
export function parsePhosphositeCombinedId(raw) {
    const all = parseAllPhosphositeCombinedIds(raw);
    return all[0] ?? null;
}
/** Expand multi-site cells into one hit per residue (same gene/accession). */
export function parseAllPhosphositeCombinedIds(raw) {
    let t = (raw || "").trim();
    if (!t)
        return [];
    t = t.replace(/__\d+$/, "");
    // GENE-T185,Y187 / GENE_T185,Y187 / CIC-S739 / 1433S_S74 / NKX2-1-S123
    const m = t.match(/^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)[_-]([A-Za-z]\d{1,5}(?:\s*,\s*[A-Za-z]\d{1,5})*)$/);
    if (!m)
        return [];
    const geneOrAcc = m[1];
    const out = [];
    const seen = new Set();
    for (const part of m[2].split(/\s*,\s*/)) {
        const site = parseSiteToken(part);
        if (!site)
            continue;
        const hit = makeHit(geneOrAcc, site.aa, site.pos);
        if (!hit)
            continue;
        const key = `${hit.geneOrAcc}|${hit.aminoAcid}|${hit.position}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(hit);
    }
    return out;
}
/** True when a cell looks like gene/acc + residue (including multi-site). */
export function looksLikePhosphositeCombinedId(raw) {
    return parsePhosphositeCombinedId(raw) != null;
}
