/**
 * Gene symbol → UniProt accession (for Stage5 sheets without UniProt column).
 * Uses UniProt ID Mapping (batch) + on-disk cache under stage5/cache/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stage5Dir } from "../utils/io.js";
const TAX_HINTS = [
    { re: /mus\s*musculus|\bmouse\b/i, taxId: 10090, name: "mouse" },
    { re: /homo\s*sapiens|\bhuman\b/i, taxId: 9606, name: "human" },
    { re: /rattus\s*norvegicus|\brat\b/i, taxId: 10116, name: "rat" },
    { re: /saccharomyces\s*cerevisiae|\byeast\b/i, taxId: 559292, name: "yeast" },
    { re: /arabidopsis\s*thaliana/i, taxId: 3702, name: "arabidopsis" },
    { re: /danio\s*rerio|\bzebrafish\b/i, taxId: 7955, name: "zebrafish" },
    { re: /gallus\s*gallus|\bchicken\b/i, taxId: 9031, name: "chicken" },
    { re: /bos\s*taurus|\bcow\b|\bbovine\b/i, taxId: 9913, name: "bovine" },
    { re: /sus\s*scrofa|\bpig\b/i, taxId: 9823, name: "pig" },
];
const BATCH_SIZE = 500;
const MAX_GENES = 20_000;
export function organismToTaxId(organism) {
    const s = (organism || "").trim();
    if (!s)
        return null;
    for (const h of TAX_HINTS) {
        if (h.re.test(s))
            return h.taxId;
    }
    return null;
}
export function normalizeGeneSymbol(raw) {
    return (raw
        .split(/[;,\s|/]+/)
        .map((x) => x.trim())
        .filter(Boolean)[0]
        ?.replace(/^gene[:=\s]+/i, "")
        .trim() ?? "");
}
function cachePath(taxId) {
    const dir = join(stage5Dir(), "cache");
    mkdirSync(dir, { recursive: true });
    return join(dir, `gene_uniprot_${taxId}.json`);
}
function loadCache(taxId) {
    const p = cachePath(taxId);
    if (!existsSync(p))
        return {};
    try {
        return JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        return {};
    }
}
function saveCache(taxId, cache) {
    writeFileSync(cachePath(taxId), JSON.stringify(cache, null, 0), "utf8");
}
async function sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
}
async function fetchJson(url, init, timeoutMs = 60_000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const link = res.headers.get("link") || "";
        const next = link.match(/<([^>]+)>\s*;\s*rel="next"/i)?.[1] || "";
        return { data, nextUrl: next };
    }
    finally {
        clearTimeout(t);
    }
}
/**
 * UniProt ID Mapping: Gene_Name → UniProtKB for one chunk of symbols.
 * Falls back to per-gene search for genes the batch job did not resolve.
 */
async function mapChunkViaIdMapping(genes, taxId) {
    const out = new Map();
    if (genes.length === 0)
        return out;
    const body = new URLSearchParams();
    body.set("from", "Gene_Name");
    body.set("to", "UniProtKB");
    body.set("ids", genes.join(","));
    body.set("taxId", String(taxId));
    let jobId = "";
    try {
        const started = (await fetchJson("https://rest.uniprot.org/idmapping/run", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body,
        })).data;
        jobId = started.jobId || "";
    }
    catch {
        return out;
    }
    if (!jobId)
        return out;
    // Poll until finished (typically seconds for a few hundred genes)
    for (let i = 0; i < 90; i++) {
        await sleep(i < 5 ? 500 : 1500);
        try {
            const st = (await fetchJson(`https://rest.uniprot.org/idmapping/status/${jobId}`, { headers: { Accept: "application/json" } }, 30_000)).data;
            const status = (st.jobStatus || "").toUpperCase();
            if (status === "FAILED" || status === "ERROR")
                return out;
            if (status === "RUNNING" || status === "NEW")
                continue;
            break;
        }
        catch {
            // keep polling
        }
    }
    let url = `https://rest.uniprot.org/idmapping/uniprotkb/results/${jobId}` +
        `?format=json&size=500`;
    const byGene = new Map();
    try {
        for (let page = 0; page < 40 && url; page++) {
            const { data, nextUrl } = await fetchJson(url, { headers: { Accept: "application/json" } }, 90_000);
            const payload = data;
            for (const r of payload.results ?? []) {
                const from = (r.from || "").trim();
                const acc = (r.to?.primaryAccession || "").trim().toUpperCase();
                if (!from || !acc)
                    continue;
                const reviewed = /reviewed|swiss/i.test(r.to?.entryType || "");
                const key = from.toLowerCase();
                const list = byGene.get(key) ?? [];
                list.push({ acc, reviewed });
                byGene.set(key, list);
            }
            url = nextUrl;
            if (!(payload.results && payload.results.length))
                break;
        }
    }
    catch {
        return out;
    }
    for (const g of genes) {
        const hits = byGene.get(g.toLowerCase());
        if (!hits?.length)
            continue;
        const preferred = hits.find((h) => h.reviewed) ?? hits[0];
        out.set(g, preferred.acc);
        out.set(g.toLowerCase(), preferred.acc);
    }
    return out;
}
/** Slow fallback for genes the batch mapper missed. */
async function fetchUniprotForGene(gene, taxId) {
    const tryQueries = [
        `(gene_exact:${gene}) AND (organism_id:${taxId}) AND (reviewed:true)`,
        `(gene_exact:${gene}) AND (organism_id:${taxId})`,
    ];
    for (const q of tryQueries) {
        const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(q)}` +
            `&fields=accession,gene_names&format=json&size=5`;
        try {
            const data = (await fetchJson(url, { headers: { Accept: "application/json" } }, 20_000)).data;
            const results = data.results ?? [];
            if (results.length === 0)
                continue;
            const gLower = gene.toLowerCase();
            const exact = results.find((r) => (r.genes ?? []).some((x) => (x.geneName?.value || "").toLowerCase() === gLower));
            const acc = (exact ?? results[0]).primaryAccession?.trim();
            if (acc)
                return acc.toUpperCase();
        }
        catch {
            // next query
        }
    }
    return null;
}
/**
 * Map unique gene symbols → UniProt accessions for a given organism string.
 * Unmapped genes are omitted from the returned Map.
 */
export async function mapGenesToUniprot(genes, organism, opts = {}) {
    const taxId = organismToTaxId(organism);
    const out = new Map();
    if (taxId == null)
        return out;
    const tax = taxId;
    const uniq = [
        ...new Set(genes
            .map(normalizeGeneSymbol)
            .filter((g) => g.length >= 1 && !/^(na|n\/a|null|-)$/i.test(g))),
    ].slice(0, MAX_GENES);
    if (uniq.length === 0)
        return out;
    const cache = loadCache(tax);
    const missing = [];
    for (const g of uniq) {
        const key = g.toLowerCase();
        if (key in cache && cache[key]) {
            const v = cache[key];
            out.set(g, v);
            out.set(key, v);
        }
        else {
            // Retry previously-unmapped symbols (batch API is cheap; nulls may be stale)
            missing.push(g);
        }
    }
    let done = uniq.length - missing.length;
    opts.onProgress?.(done, uniq.length);
    // Batch ID mapping in chunks
    for (let start = 0; start < missing.length; start += BATCH_SIZE) {
        const chunk = missing.slice(start, start + BATCH_SIZE);
        const mapped = await mapChunkViaIdMapping(chunk, tax);
        const stillMissing = [];
        for (const g of chunk) {
            const acc = mapped.get(g) || mapped.get(g.toLowerCase());
            if (acc) {
                cache[g.toLowerCase()] = acc;
                out.set(g, acc);
                out.set(g.toLowerCase(), acc);
            }
            else {
                stillMissing.push(g);
            }
            done++;
        }
        opts.onProgress?.(Math.min(done, uniq.length), uniq.length);
        // Persist after each chunk so retries keep progress
        saveCache(tax, cache);
        // Fallback for a small remainder (batch misses)
        const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, 10));
        let fi = 0;
        async function fallbackWorker() {
            while (true) {
                const idx = fi++;
                if (idx >= stillMissing.length)
                    return;
                const g = stillMissing[idx];
                const acc = await fetchUniprotForGene(g, tax);
                cache[g.toLowerCase()] = acc;
                if (acc) {
                    out.set(g, acc);
                    out.set(g.toLowerCase(), acc);
                }
            }
        }
        if (stillMissing.length > 0) {
            await Promise.all(Array.from({ length: Math.min(concurrency, stillMissing.length) }, () => fallbackWorker()));
            saveCache(tax, cache);
        }
        opts.onProgress?.(Math.min(done, uniq.length), uniq.length);
    }
    saveCache(tax, cache);
    return out;
}
