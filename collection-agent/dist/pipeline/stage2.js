import { appendFileSync, existsSync, readFileSync, writeFileSync, } from "node:fs";
import { loadIncludePmidsCsv, stage2Dir, stage2ManualQueuePath, stage2ManifestJsonlPath, stage2ResultsCsvPath, } from "../utils/io.js";
import { discoverForPmid } from "../stage2/discover.js";
function csvEscape(v) {
    if (/[",\n\r]/.test(v))
        return `"${v.replace(/"/g, '""')}"`;
    return v;
}
/** Stage 2 reads only stage1_include_pmids.csv (self-contained, includes Abstract). */
export function loadStage2Inputs() {
    return loadIncludePmidsCsv().map((r) => ({
        pmid: r.pmid,
        title: r.title,
        reason: r.reason,
        dataSourceHint: r.dataSourceHint,
        abstract: r.abstract,
    }));
}
/**
 * Stratified pilot sample:
 * - up to n/3 proteomexchange
 * - up to n/3 supplementary
 * - rest main_text/unknown (prefer those with accession-like text)
 */
export function pickPilotSample(all, n) {
    const byHint = (hint) => all.filter((r) => r.dataSourceHint === hint);
    const hasAcc = (r) => /\b(PXD\d+|IPX\d+|JPST\d+|MSV\d+|PDC\d+)\b/i.test(`${r.abstract} ${r.reason} ${r.title}`);
    const px = byHint("proteomexchange");
    const supp = byHint("supplementary");
    const rest = all.filter((r) => r.dataSourceHint !== "proteomexchange" && r.dataSourceHint !== "supplementary");
    rest.sort((a, b) => Number(hasAcc(b)) - Number(hasAcc(a)));
    const take = Math.max(1, Math.floor(n / 3));
    const picked = [];
    const used = new Set();
    const pushMany = (rows, limit) => {
        for (const r of rows) {
            if (picked.length >= n)
                break;
            if (used.has(r.pmid))
                continue;
            if (limit <= 0)
                break;
            used.add(r.pmid);
            picked.push(r);
            limit--;
        }
    };
    pushMany(px, take);
    pushMany(supp, take);
    pushMany(rest, n - picked.length);
    // fill if short
    pushMany(all, n - picked.length);
    return picked;
}
function loadDonePmids(jsonlPath) {
    const done = new Set();
    if (!existsSync(jsonlPath))
        return done;
    for (const line of readFileSync(jsonlPath, "utf8").split("\n")) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const row = JSON.parse(t);
            if (row.pmid)
                done.add(row.pmid);
        }
        catch {
            // skip
        }
    }
    return done;
}
export function writeStage2Outputs(manifests) {
    stage2Dir();
    const jsonlPath = stage2ManifestJsonlPath();
    writeFileSync(jsonlPath, manifests.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
    const header = [
        "PMID",
        "Title",
        "status",
        "doi",
        "pmcid",
        "isOpenAccess",
        "accessions",
        "sources",
        "channelsHit",
        "needsPdf",
        "dataSourceHint",
        "notes",
        "error",
        "discoveredAt",
    ];
    const lines = [header.join(",")];
    for (const m of manifests) {
        lines.push([
            csvEscape(m.pmid),
            csvEscape(m.title),
            csvEscape(m.status),
            csvEscape(m.doi ?? ""),
            csvEscape(m.pmcid ?? ""),
            String(m.isOpenAccess),
            csvEscape(m.repositories.map((r) => r.id).join(";")),
            csvEscape(m.repositories.map((r) => r.source).join(";")),
            csvEscape(m.channelsHit.join(";")),
            String(m.needsPdf),
            csvEscape(m.dataSourceHint ?? ""),
            csvEscape(m.notes),
            csvEscape(m.error ?? ""),
            csvEscape(m.discoveredAt),
        ].join(","));
    }
    writeFileSync(stage2ResultsCsvPath(), lines.join("\n") + "\n", "utf8");
    const manual = manifests.filter((m) => m.needsPdf || m.status === "not_found" || m.status === "error");
    const mHeader = ["PMID", "Title", "doi", "pmcid", "status", "notes", "error"];
    const mLines = [mHeader.join(",")];
    for (const m of manual) {
        mLines.push([
            csvEscape(m.pmid),
            csvEscape(m.title),
            csvEscape(m.doi ?? ""),
            csvEscape(m.pmcid ?? ""),
            csvEscape(m.status),
            csvEscape(m.notes),
            csvEscape(m.error ?? ""),
        ].join(","));
    }
    writeFileSync(stage2ManualQueuePath(), mLines.join("\n") + "\n", "utf8");
}
export function appendStage2Manifest(m) {
    stage2Dir();
    appendFileSync(stage2ManifestJsonlPath(), JSON.stringify(m) + "\n", "utf8");
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
export async function runStage2Discover(options = {}) {
    const concurrency = Math.max(1, options.concurrency ?? 2);
    let inputs = loadStage2Inputs();
    if (options.pmid) {
        inputs = inputs.filter((r) => r.pmid === options.pmid);
    }
    else if (options.pilot) {
        inputs = pickPilotSample(inputs, options.limit ?? 50);
    }
    else if (!options.all) {
        inputs = inputs.slice(0, options.limit ?? 20);
    }
    const jsonlPath = stage2ManifestJsonlPath();
    const done = options.resume ? loadDonePmids(jsonlPath) : new Set();
    if (!options.resume && existsSync(jsonlPath) && !options.pmid) {
        writeFileSync(jsonlPath, "", "utf8");
    }
    const pending = inputs.filter((r) => !done.has(r.pmid));
    const prior = [];
    if (options.resume && existsSync(jsonlPath)) {
        for (const line of readFileSync(jsonlPath, "utf8").split("\n")) {
            const t = line.trim();
            if (!t)
                continue;
            try {
                prior.push(JSON.parse(t));
            }
            catch {
                // skip
            }
        }
    }
    const fresh = await mapPool(pending, concurrency, async (row, index) => {
        const m = await discoverForPmid({
            pmid: row.pmid,
            title: row.title,
            abstract: row.abstract,
            stage1Reason: row.reason,
            dataSourceHint: row.dataSourceHint,
        });
        appendStage2Manifest(m);
        options.onResult?.(m, index, pending.length);
        return m;
    });
    const all = [...prior, ...fresh];
    // de-dupe by pmid keeping last
    const byPmid = new Map();
    for (const m of all)
        byPmid.set(m.pmid, m);
    const manifests = [...byPmid.values()];
    writeStage2Outputs(manifests);
    const channelCounts = {};
    for (const m of manifests) {
        for (const c of m.channelsHit)
            channelCounts[c] = (channelCounts[c] ?? 0) + 1;
    }
    return {
        attempted: manifests.length,
        found: manifests.filter((m) => m.status === "found").length,
        notFound: manifests.filter((m) => m.status === "not_found").length,
        errors: manifests.filter((m) => m.status === "error").length,
        needsPdf: manifests.filter((m) => m.needsPdf).length,
        channelCounts,
    };
}
