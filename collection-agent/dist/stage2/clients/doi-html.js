import { fetchText } from "../http.js";
import { extractAccessions } from "../accessions.js";
/**
 * Fetch DOI landing page HTML (publisher) and regex-extract repository IDs.
 * Best-effort; many publishers block bots — failures are non-fatal.
 */
export async function fetchDoiLandingAccessions(doi) {
    const url = `https://doi.org/${doi}`;
    try {
        const html = await fetchText(url, {
            timeoutMs: 25_000,
            accept: "text/html,application/xhtml+xml,*/*",
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; qPTM-CollectionAgent/0.1; +https://github.com/local)",
            },
        });
        // Prefer Data Availability-ish window if present
        const lower = html.toLowerCase();
        const idx = lower.search(/data availability|data availability statement|accession|proteomexchange|pride/);
        const window = idx >= 0 ? html.slice(Math.max(0, idx - 500), idx + 8000) : html.slice(0, 200_000);
        return extractAccessions(window, "doi:html");
    }
    catch {
        return [];
    }
}
