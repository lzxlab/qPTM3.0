/** Split Stage3 Identifier field into individual accessions. */
export function splitIdentifiers(identifier) {
    if (!identifier.trim())
        return [];
    const seen = new Set();
    const out = [];
    for (const part of identifier.split(/[;,]/)) {
        const id = part.trim().toUpperCase();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
export function repoFromAccession(id) {
    if (/^PXD\d+$/i.test(id))
        return "PRIDE";
    if (/^IPX\d+$/i.test(id))
        return "iProX";
    if (/^JPST\d+$/i.test(id))
        return "jPOST";
    if (/^MSV\d+$/i.test(id))
        return "MassIVE";
    if (/^PDC\d+$/i.test(id))
        return "PDC";
    return "unknown";
}
/** Prefer accession prefix; fall back to msDataSource hints. */
export function resolveRepo(id, msDataSource) {
    const byId = repoFromAccession(id);
    if (byId !== "unknown")
        return byId;
    const src = msDataSource.toLowerCase();
    if (src.includes("jpost"))
        return "jPOST";
    if (src.includes("iprox"))
        return "iProX";
    if (src.includes("massive") || src.includes("msv"))
        return "MassIVE";
    if (src.includes("pride") || src.includes("proteomexchange"))
        return "PRIDE";
    if (src.includes("cptac") || src.includes("pdc"))
        return "PDC";
    return "unknown";
}
/** Pick a PXD from the same paper to fetch ProteomeXchange XML for iProX datasets. */
export function pickPxdForIprox(ids) {
    return ids.find((id) => /^PXD\d+$/i.test(id));
}
