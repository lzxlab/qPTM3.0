import { fetchJson } from "../http.js";
/** PRIDE search by DOI (pubmed keyword search is unreliable). */
export async function searchPrideByDoi(doi) {
    const url = `https://www.ebi.ac.uk/pride/ws/archive/v2/search/projects` +
        `?keyword=${encodeURIComponent(doi)}&pageSize=20`;
    try {
        const rows = await fetchJson(url);
        if (!Array.isArray(rows))
            return [];
        return rows
            .map((r) => r.accession)
            .filter((a) => Boolean(a && /^PXD\d+/i.test(a)))
            .map((id) => ({ id: id.toUpperCase(), source: "PRIDE", via: "pride:doi" }));
    }
    catch {
        return [];
    }
}
export async function searchPrideByKeyword(keyword, via) {
    const url = `https://www.ebi.ac.uk/pride/ws/archive/v2/search/projects` +
        `?keyword=${encodeURIComponent(keyword)}&pageSize=10`;
    try {
        const rows = await fetchJson(url);
        if (!Array.isArray(rows))
            return [];
        return rows
            .map((r) => r.accession)
            .filter((a) => Boolean(a && /^PXD\d+/i.test(a)))
            .map((id) => ({ id: id.toUpperCase(), source: "PRIDE", via }));
    }
    catch {
        return [];
    }
}
