import { appendFileSync, existsSync, readFileSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { fetchFulltextForPmid, } from "../stage2/fulltext.js";
import { loadDotEnv } from "../runtime.js";
import { loadIncludePmidsCsv, stage2FulltextDir, stage2FulltextManualQueuePath, stage2FulltextManifestPath, stage2FulltextResultsCsvPath, stage2ManifestJsonlPath, } from "../utils/io.js";
function csvEscape(v) {
    if (/[",\n\r]/.test(v))
        return `"${v.replace(/"/g, '""')}"`;
    return v;
}
function loadDiscoverByPmid() {
    const path = stage2ManifestJsonlPath();
    const map = new Map();
    if (!existsSync(path))
        return map;
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const row = JSON.parse(t);
            if (row.pmid)
                map.set(row.pmid, row);
        }
        catch {
            // skip
        }
    }
    return map;
}
function loadMeta(pmid) {
    const metaPath = join(stage2FulltextDir(), pmid, "meta.json");
    if (!existsSync(metaPath))
        return null;
    try {
        return JSON.parse(readFileSync(metaPath, "utf8"));
    }
    catch {
        return null;
    }
}
/** Success = has xml or pdf; keep these when resuming / retrying. */
function isSuccess(meta) {
    return Boolean(meta.hasXml || meta.hasPdf);
}
function needsRetry(meta) {
    return meta.status === "unavailable" || meta.status === "error" || !isSuccess(meta);
}
function loadPriorManifest() {
    const path = stage2FulltextManifestPath();
    if (!existsSync(path))
        return [];
    const out = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            out.push(JSON.parse(t));
        }
        catch {
            // skip
        }
    }
    return out;
}
export function writeFulltextOutputs(records) {
    writeFileSync(stage2FulltextManifestPath(), records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    const header = [
        "PMID",
        "Title",
        "status",
        "doi",
        "pmcid",
        "hasXml",
        "hasPdf",
        "sources",
        "notes",
        "error",
        "fetchedAt",
    ];
    const lines = [header.join(",")];
    for (const r of records) {
        lines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            csvEscape(r.status),
            csvEscape(r.doi ?? ""),
            csvEscape(r.pmcid ?? ""),
            String(r.hasXml),
            String(r.hasPdf),
            csvEscape(r.sources.join(";")),
            csvEscape(r.notes),
            csvEscape(r.error ?? ""),
            csvEscape(r.fetchedAt),
        ].join(","));
    }
    writeFileSync(stage2FulltextResultsCsvPath(), lines.join("\n") + "\n", "utf8");
    const manual = records.filter((r) => r.status === "unavailable" || r.status === "error" || (!r.hasXml && !r.hasPdf));
    const mHeader = ["PMID", "Title", "doi", "pmcid", "status", "notes", "error"];
    const mLines = [mHeader.join(",")];
    for (const r of manual) {
        mLines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            csvEscape(r.doi ?? ""),
            csvEscape(r.pmcid ?? ""),
            csvEscape(r.status),
            csvEscape(r.notes),
            csvEscape(r.error ?? ""),
        ].join(","));
    }
    writeFileSync(stage2FulltextManualQueuePath(), mLines.join("\n") + "\n", "utf8");
}
async function mapPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function runner() {
        while (true) {
            const i = next++;
            if (i >= items.length)
                return;
            results[i] = await worker(items[i], i);
        }
    }
    const n = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: n }, () => runner()));
    return results;
}
export async function runStage2Fulltext(options = {}) {
    loadDotEnv();
    const concurrency = Math.max(1, options.concurrency ?? 2);
    const retryUnavailable = options.retryUnavailable ?? false;
    const resume = options.resume || retryUnavailable;
    const discover = loadDiscoverByPmid();
    let inputs = loadIncludePmidsCsv();
    if (options.pmid) {
        inputs = inputs.filter((r) => r.pmid === options.pmid);
    }
    else if (!options.all) {
        inputs = inputs.slice(0, options.limit ?? 30);
    }
    const prior = resume ? loadPriorManifest() : [];
    const priorByPmid = new Map(prior.map((r) => [r.pmid, r]));
    if (!resume) {
        writeFileSync(stage2FulltextManifestPath(), "", "utf8");
    }
    const pending = resume
        ? inputs.filter((r) => {
            const meta = loadMeta(r.pmid) ?? priorByPmid.get(r.pmid) ?? null;
            if (!meta)
                return true;
            if (isSuccess(meta))
                return false;
            if (retryUnavailable && needsRetry(meta))
                return true;
            // plain --resume: skip anything already attempted
            return false;
        })
        : inputs;
    if (retryUnavailable) {
        console.error(`Retry unavailable: ${pending.length} PMID(s) to re-fetch`);
    }
    const fresh = await mapPool(pending, concurrency, async (row, index) => {
        const disc = discover.get(row.pmid);
        const record = await fetchFulltextForPmid({
            pmid: row.pmid,
            title: row.title || disc?.title,
            doi: disc?.doi ?? null,
            pmcid: disc?.pmcid ?? null,
            isOpenAccess: disc?.isOpenAccess,
        });
        appendFileSync(stage2FulltextManifestPath(), JSON.stringify(record) + "\n", "utf8");
        options.onResult?.(record, index, pending.length);
        return record;
    });
    const byPmid = new Map();
    for (const r of prior) {
        // Drop prior unavailable/error when retrying so fresh results win
        if (retryUnavailable && needsRetry(r) && !isSuccess(r))
            continue;
        byPmid.set(r.pmid, r);
    }
    for (const r of fresh)
        byPmid.set(r.pmid, r);
    // Also pick up any resume skips that have meta on disk but weren't in prior jsonl
    for (const row of inputs) {
        if (byPmid.has(row.pmid))
            continue;
        const meta = loadMeta(row.pmid);
        if (!meta)
            continue;
        if (retryUnavailable && needsRetry(meta) && !isSuccess(meta))
            continue;
        byPmid.set(row.pmid, meta);
    }
    const records = inputs
        .map((r) => byPmid.get(r.pmid))
        .filter((r) => Boolean(r));
    writeFulltextOutputs(records);
    return {
        attempted: records.length,
        ok: records.filter((r) => r.status === "ok").length,
        partial: records.filter((r) => r.status === "partial").length,
        unavailable: records.filter((r) => r.status === "unavailable").length,
        errors: records.filter((r) => r.status === "error").length,
        withXml: records.filter((r) => r.hasXml).length,
        withPdf: records.filter((r) => r.hasPdf).length,
    };
}
