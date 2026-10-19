import { fetchJson } from "../http.js";
import { extractAccessions, sourceFromId } from "../accessions.js";
/**
 * Fetch ProteomeXchange Central JSON for a known accession (PXD/MSV/…).
 * Used to harvest cross-repository mirrors (e.g. PXD ↔ MSV).
 */
export async function fetchPxDataset(accession) {
    const url = `https://proteomecentral.proteomexchange.org/cgi/GetDataset` +
        `?ID=${encodeURIComponent(accession)}&outputMode=JSON&test=no`;
    try {
        const data = await fetchJson(url);
        const hits = [];
        const seen = new Set();
        const push = (id, via) => {
            const u = id.toUpperCase();
            if (seen.has(u))
                return;
            seen.add(u);
            hits.push({ id: u, source: sourceFromId(u), via });
        };
        push(accession, "px:self");
        for (const id of data.identifiers ?? []) {
            const v = id.value?.trim();
            if (!v)
                continue;
            const extracted = extractAccessions(v, "px:identifiers");
            if (extracted.length) {
                for (const e of extracted)
                    push(e.id, e.via);
            }
        }
        return hits;
    }
    catch {
        return [{ id: accession.toUpperCase(), source: sourceFromId(accession), via: "px:lookup-failed" }];
    }
}
/** Expand a set of accessions via PX Central cross-links */
export async function expandViaProteomeXchange(ids) {
    const interesting = ids.filter((id) => /^(PXD|MSV|PDC|PASS)/i.test(id));
    const all = [];
    // PX Central lookups are independent — run them concurrently (bounded).
    const results = await Promise.all(interesting.map((id) => fetchPxDataset(id)));
    for (const hits of results)
        all.push(...hits);
    return all;
}
