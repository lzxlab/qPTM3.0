import { fetchJson } from "../http.js";
import { extractAccessions } from "../accessions.js";
/**
 * MassIVE PROXI `keyword=` search is extremely noisy: querying one MSV accession
 * often returns ~100 unrelated datasets. Never scrape every MSV id from the
 * response blob — only accept the primary identifier of a row that actually
 * matches the query (or DOI filter).
 */
function cvValues(row, nameRe) {
    if (!row || typeof row !== "object")
        return [];
    const out = [];
    const visit = (v) => {
        if (Array.isArray(v)) {
            for (const x of v)
                visit(x);
            return;
        }
        if (!v || typeof v !== "object")
            return;
        const p = v;
        if (p.name && nameRe.test(p.name) && typeof p.value === "string" && p.value.trim()) {
            out.push(p.value.trim());
        }
        for (const child of Object.values(v)) {
            if (child && typeof child === "object")
                visit(child);
        }
    };
    visit(row);
    return out;
}
/** Primary MassIVE accession for a PROXI dataset row (MS:1002487). */
export function primaryMassiveAccession(row) {
    for (const v of cvValues(row, /massive\s+dataset\s+identifier/i)) {
        const m = v.toUpperCase().match(/\b(MSV\d{9})\b/);
        if (m)
            return m[1];
    }
    // Fallback: first MSV in accession field only (not whole-row scrape)
    if (row && typeof row === "object" && "accession" in row) {
        const hits = extractAccessions(JSON.stringify(row.accession), "massive:accession");
        const msv = hits.find((h) => h.source === "MassIVE");
        if (msv)
            return msv.id;
    }
    return null;
}
function mirrorsFromRow(row, via) {
    // Cross-repo mirrors on the matched row only (e.g. PXD), never sibling MSVs
    const blob = JSON.stringify(row);
    return extractAccessions(blob, via).filter((h) => h.source !== "MassIVE");
}
/**
 * Resolve a known MSV accession. PROXI keyword search may return unrelated
 * rows — only keep a hit when the row's primary id equals the query.
 */
export async function lookupMassiveByAccession(msvId) {
    const id = msvId.toUpperCase();
    if (!/^MSV\d+$/.test(id))
        return [];
    const url = `https://massive.ucsd.edu/ProteoSAFe/proxi/v0.1/datasets` +
        `?resultType=full&keyword=${encodeURIComponent(id)}`;
    try {
        const rows = await fetchJson(url);
        if (!Array.isArray(rows) || rows.length === 0) {
            return [{ id, source: "MassIVE", via: "massive:assumed" }];
        }
        for (const row of rows) {
            const primary = primaryMassiveAccession(row);
            if (primary !== id)
                continue;
            return [
                { id, source: "MassIVE", via: "massive:proxi" },
                ...mirrorsFromRow(row, "massive:proxi"),
            ];
        }
        // Keyword search returned unrelated datasets — do not harvest them.
        return [{ id, source: "MassIVE", via: "massive:assumed" }];
    }
    catch {
        return [{ id, source: "MassIVE", via: "massive:lookup-failed" }];
    }
}
export async function searchMassiveByDoi(doi) {
    // PROXI keyword with DOI often returns unrelated pages; keep conservative:
    // only accept rows that mention the DOI, and only their primary MSV id.
    const url = `https://massive.ucsd.edu/ProteoSAFe/proxi/v0.1/datasets` +
        `?resultType=full&keyword=${encodeURIComponent(doi)}`;
    try {
        const rows = await fetchJson(url, { timeoutMs: 25_000 });
        if (!Array.isArray(rows))
            return [];
        const hits = [];
        const seen = new Set();
        for (const row of rows.slice(0, 20)) {
            const blob = JSON.stringify(row);
            if (!blob.includes(doi) && !blob.toLowerCase().includes(doi.toLowerCase()))
                continue;
            const primary = primaryMassiveAccession(row);
            if (!primary || seen.has(primary))
                continue;
            seen.add(primary);
            hits.push({ id: primary, source: "MassIVE", via: "massive:doi" });
            for (const m of mirrorsFromRow(row, "massive:doi")) {
                if (seen.has(m.id))
                    continue;
                seen.add(m.id);
                hits.push(m);
            }
        }
        return hits;
    }
    catch {
        return [];
    }
}
