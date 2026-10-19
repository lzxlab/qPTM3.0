import { fetchBinary, fetchJson, fetchText } from "../http.js";
export async function fetchEuropePmcMeta(pmid) {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
        `?query=${encodeURIComponent(`EXT_ID:${pmid} AND SRC:MED`)}` +
        `&format=json&resultType=core`;
    const data = await fetchJson(url);
    const r = data.resultList?.result?.[0];
    if (!r) {
        return { pmid, doi: null, pmcid: null, isOpenAccess: false, title: null };
    }
    return {
        pmid,
        doi: r.doi ?? null,
        pmcid: r.pmcid ?? null,
        isOpenAccess: String(r.isOpenAccess ?? "").toUpperCase() === "Y",
        title: r.title ?? null,
    };
}
/** Full-text JATS XML when OA / PMC available */
export async function fetchEuropePmcFullTextXml(pmcid) {
    const id = pmcid.replace(/^PMC/i, "");
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC${id}/fullTextXML`;
    try {
        const text = await fetchText(url, { timeoutMs: 30_000, accept: "application/xml,text/xml,*/*" });
        if (!text.includes("<article") && !text.includes("<!DOCTYPE")) {
            // sometimes error payload
            if (text.length < 200)
                return null;
        }
        return text;
    }
    catch {
        return null;
    }
}
/** Europe PMC PDF render URL (OA articles only typically) */
export function europePmcPdfUrl(pmcid) {
    const id = pmcid.replace(/^PMC/i, "");
    return `https://europepmc.org/articles/PMC${id}?pdf=render`;
}
/**
 * Download PDF from Europe PMC. Returns null if not a PDF payload
 * (e.g. HTML interstitial / paywall page).
 */
export async function fetchEuropePmcPdf(pmcid) {
    const url = europePmcPdfUrl(pmcid);
    try {
        const { buffer, contentType } = await fetchBinary(url, {
            timeoutMs: 90_000,
            accept: "application/pdf,*/*",
        });
        if (buffer.length < 1000)
            return null;
        const isPdf = buffer.subarray(0, 4).toString("ascii") === "%PDF" ||
            (contentType ?? "").toLowerCase().includes("pdf");
        if (!isPdf)
            return null;
        return buffer;
    }
    catch {
        return null;
    }
}
/** Europe PMC OA supplementary files ZIP (may include images unless excluded). */
export function europePmcSupplementaryUrl(pmcid, includeInlineImage = false) {
    const id = pmcid.replace(/^PMC/i, "");
    const inline = includeInlineImage ? "true" : "false";
    return (`https://www.ebi.ac.uk/europepmc/webservices/rest/PMC${id}/supplementaryFiles` +
        `?includeInlineImage=${inline}`);
}
/**
 * Download supplementaryFiles ZIP for a PMCID.
 * Returns status empty/not_found when OA package is missing.
 */
export async function fetchEuropePmcSupplementaryZip(pmcid) {
    const url = europePmcSupplementaryUrl(pmcid, false);
    try {
        const { buffer, contentType } = await fetchBinary(url, {
            timeoutMs: 120_000,
            accept: "application/zip,application/octet-stream,*/*",
        });
        if (buffer.length < 64) {
            return { status: "empty", buffer: null, contentType, url };
        }
        // ZIP local header magic
        if (buffer.subarray(0, 2).toString("ascii") !== "PK") {
            const head = buffer.subarray(0, Math.min(200, buffer.length)).toString("utf8");
            if (/not found|no supplementary|error/i.test(head)) {
                return { status: "not_found", buffer: null, contentType, url, error: head.slice(0, 120) };
            }
            return {
                status: "error",
                buffer: null,
                contentType,
                url,
                error: `Not a ZIP (content-type=${contentType ?? "unknown"})`,
            };
        }
        return { status: "ok", buffer, contentType, url };
    }
    catch (err) {
        const status = err instanceof Error && /HTTP 404/.test(err.message) ? "not_found" : "error";
        return {
            status,
            buffer: null,
            contentType: null,
            url,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
