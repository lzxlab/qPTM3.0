/**
 * NCBI E-utilities efetch — batch title/abstract by PMID.
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 */
import { fetchText } from "../../stage2/http.js";
function decodeXmlEntities(s) {
    return s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function stripTags(s) {
    return decodeXmlEntities(s.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}
/** Parse PubmedArticleSet XML into title/abstract records. */
export function parsePubmedEfetchXml(xml) {
    const out = [];
    const articles = xml.split(/<\/PubmedArticle>/i);
    for (const chunk of articles) {
        if (!/<PubmedArticle\b/i.test(chunk))
            continue;
        const pmidMatch = chunk.match(/<PMID[^>]*>\s*(\d+)\s*<\/PMID>/i);
        if (!pmidMatch)
            continue;
        const pmid = pmidMatch[1];
        const titleMatch = chunk.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/i);
        const title = titleMatch ? stripTags(titleMatch[1]) : "";
        const absBlock = chunk.match(/<Abstract\b[^>]*>([\s\S]*?)<\/Abstract>/i);
        let abstract = "";
        if (absBlock) {
            const parts = [];
            const re = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi;
            let m;
            while ((m = re.exec(absBlock[1])) !== null) {
                const attrs = m[1] ?? "";
                const labelMatch = attrs.match(/\bLabel="([^"]*)"/i);
                const text = stripTags(m[2] ?? "");
                if (!text)
                    continue;
                parts.push(labelMatch ? `${labelMatch[1]}: ${text}` : text);
            }
            abstract = parts.join(" ");
        }
        out.push({ pmid, title, abstract });
    }
    return out;
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function envToolEmail() {
    return {
        tool: process.env.NCBI_TOOL?.trim() || "qPTM-CollectionAgent",
        email: process.env.NCBI_EMAIL?.trim() || process.env.UNPAYWALL_EMAIL?.trim() || undefined,
        apiKey: process.env.NCBI_API_KEY?.trim() || undefined,
    };
}
/**
 * Batch-fetch title/abstract via efetch.
 * NCBI allows up to ~200 ids per request; we use 100 and pace requests.
 */
export async function fetchPubmedAbstracts(pmids, opts = {}) {
    const unique = [...new Set(pmids.map((p) => p.trim()).filter(Boolean))];
    const out = new Map();
    if (unique.length === 0)
        return out;
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 100, 200));
    const { tool, email, apiKey } = envToolEmail();
    // Without API key NCBI asks ≤3 req/s; with key ≤10. Be conservative.
    const pauseMs = opts.pauseMs ?? (apiKey ? 120 : 350);
    for (let i = 0; i < unique.length; i += batchSize) {
        if (i > 0)
            await sleep(pauseMs);
        const batch = unique.slice(i, i + batchSize);
        const params = new URLSearchParams({
            db: "pubmed",
            id: batch.join(","),
            retmode: "xml",
            tool,
        });
        if (email)
            params.set("email", email);
        if (apiKey)
            params.set("api_key", apiKey);
        const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`;
        const xml = await fetchText(url, {
            timeoutMs: 60_000,
            accept: "application/xml,text/xml,*/*",
        });
        for (const rec of parsePubmedEfetchXml(xml)) {
            out.set(rec.pmid, rec);
        }
    }
    return out;
}
