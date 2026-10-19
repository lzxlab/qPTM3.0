import { fetchJson } from "../http.js";
function pickPdfUrl(data) {
    const locs = [
        data.best_oa_location,
        ...(data.oa_locations ?? []),
    ].filter(Boolean);
    for (const loc of locs) {
        if (loc?.url_for_pdf) {
            return {
                pdfUrl: loc.url_for_pdf,
                source: loc.host_type ?? null,
                license: loc.license ?? null,
            };
        }
    }
    return { pdfUrl: null, source: null, license: null };
}
/** Unpaywall requires a contact email in the query string. */
export async function lookupUnpaywall(doi, email) {
    const cleaned = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(cleaned)}` +
        `?email=${encodeURIComponent(email)}`;
    const data = await fetchJson(url, { timeoutMs: 25_000 });
    const picked = pickPdfUrl(data);
    return {
        doi: data.doi ?? cleaned,
        isOa: Boolean(data.is_oa),
        pdfUrl: picked.pdfUrl,
        source: picked.source,
        license: picked.license,
    };
}
