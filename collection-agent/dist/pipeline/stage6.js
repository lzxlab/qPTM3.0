/**
 * Stage 6 — Resolve MS repository download URLs for Stage5-success papers.
 *
 * Joins qratio_success + Stage3 literature_info (MS data source, Identifier),
 * fetches repository listing HTML / ProteomeXchange XML, then runs qPTM3 get_url scripts.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { pickPxdForIprox, repoFromAccession, resolveRepo, splitIdentifiers, } from "../stage6/accessions.js";
import { resolveGetUrlScripts, runIproxExtract, runPdcExtract, runPrideExtract, } from "../stage6/extract.js";
import { jpostFetchAllFiles } from "../stage6/jpost-api.js";
import { pmidForOutput, shortModification, shortOrganism, stage6UrlsBasename, } from "../stage6/naming.js";
import { resolveSingleModification } from "../stage5/ptm.js";
import { downloadIproxXml, downloadPrideListingHtml, } from "../stage6/repos.js";
import { iproxAsperaSource, iproxFetchSubproject, iproxGetProject, } from "../stage6/iprox-api.js";
import { csvEscape, loadLiteratureInfoCsv, loadQratioSuccessCsv, stage6CacheDir, stage6DownloadJobsPath, stage6ResultsJsonlPath, stage6UrlsAllPath, stage6UrlsDir, } from "../utils/io.js";
function loadStage6Done() {
    const path = stage6ResultsJsonlPath();
    const map = new Map();
    if (!existsSync(path))
        return map;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const row = JSON.parse(t);
            if (row.pmid)
                map.set(row.pmid, row);
        }
        catch {
            // skip bad line
        }
    }
    return map;
}
/** Paper-level Stage6 status: ok when any repo yields download URLs. */
export function aggregateStage6Status(accessions) {
    if (accessions.length === 0)
        return "error";
    const totalUrls = accessions.reduce((n, a) => n + a.urlCount, 0);
    if (totalUrls > 0)
        return "ok";
    if (accessions.every((a) => a.status === "skipped"))
        return "skipped";
    if (accessions.some((a) => a.status === "partial" || a.status === "ok"))
        return "partial";
    return "error";
}
function aggregateStatus(accessions) {
    return aggregateStage6Status(accessions);
}
async function extractAccession(pmid, accession, repo, allIds, organism, modification, getUrlDir) {
    const scripts = resolveGetUrlScripts(getUrlDir);
    const cacheDir = join(stage6CacheDir(), accession);
    mkdirSync(cacheDir, { recursive: true });
    const base = {
        accession,
        repo,
        status: "error",
        urlCount: 0,
        rawUrlCount: 0,
        sourceFile: "",
        urlsFile: "",
        organism,
        modification,
        notes: "",
    };
    try {
        if (repo === "PRIDE" || repo === "MassIVE") {
            const htmlPath = join(cacheDir, `${accession}.html`);
            const dirUrl = await downloadPrideListingHtml(accession, htmlPath);
            base.sourceFile = htmlPath;
            const workDir = join(cacheDir, "extract");
            mkdirSync(workDir, { recursive: true });
            const out = runPrideExtract(htmlPath, scripts, workDir);
            base.urlCount = out.urls.length;
            base.rawUrlCount = out.rawUrlCount;
            base.urlsFile = copyToUrlsDir(pmid, accession, organism, modification, out.urlsFile);
            base.status = out.urls.length > 0 ? "ok" : "partial";
            base.notes = `PRIDE FTP listing ${dirUrl}`;
            return base;
        }
        if (repo === "iProX") {
            const pxd = pickPxdForIprox(allIds);
            const projectApi = await iproxGetProject(accession).catch(() => undefined);
            if (projectApi?.code !== 200) {
                const sub = await iproxFetchSubproject(accession);
                if (sub) {
                    const cacheJson = join(cacheDir, "subproject.json");
                    writeFileSync(cacheJson, JSON.stringify(sub, null, 2), "utf8");
                    const urlsPath = join(cacheDir, `${accession}_urls_${sub.urls.length}.txt`);
                    writeFileSync(urlsPath, sub.urls.join("\n") + "\n", "utf8");
                    base.sourceFile = cacheJson;
                    base.urlCount = sub.urls.length;
                    base.rawUrlCount = sub.urls.filter((u) => isRawUrl(u)).length;
                    base.urlsFile = copyToUrlsDir(pmid, accession, organism, modification, urlsPath);
                    const aspera = process.env.IPROX_USERNAME
                        ? iproxAsperaSource(sub.parentProjectId, process.env.IPROX_USERNAME)
                        : "";
                    const parts = [
                        `iProX subproject parent=${sub.parentProjectId}`,
                        `API=PMD009Controller/findBySubProjectId`,
                        `page=subproject.html`,
                        `files=${sub.files.length}`,
                    ];
                    if (aspera)
                        parts.push(`Aspera:${aspera}/${accession}`);
                    base.notes = parts.join("; ");
                    base.status = sub.urls.length > 0 ? "ok" : "partial";
                    return base;
                }
            }
            const xmlPath = join(cacheDir, `${accession}.xml`);
            const { sourceUrl, pxd: pxdFromXml } = await downloadIproxXml(accession, xmlPath, { pxd });
            base.sourceFile = xmlPath;
            const aspera = process.env.IPROX_USERNAME
                ? iproxAsperaSource(accession, process.env.IPROX_USERNAME)
                : "";
            const parts = [`iProX XML ${sourceUrl}`];
            if (pxdFromXml || pxd)
                parts.push(`PXD=${pxdFromXml ?? pxd}`);
            if (projectApi?.code === 200)
                parts.push("iProX API:ok");
            else if (projectApi?.code === 222)
                parts.push("iProX API:no_public_data");
            if (aspera)
                parts.push(`Aspera:${aspera}`);
            base.notes = parts.join("; ");
            const out = runIproxExtract(xmlPath, scripts);
            base.urlCount = out.urls.length;
            base.rawUrlCount = out.rawUrlCount;
            base.urlsFile = copyToUrlsDir(pmid, accession, organism, modification, out.urlsFile);
            base.status = out.urls.length > 0 ? "ok" : "partial";
            return base;
        }
        if (repo === "jPOST") {
            const { files, urls } = await jpostFetchAllFiles(accession);
            const cacheJson = join(cacheDir, "files.json");
            writeFileSync(cacheJson, JSON.stringify({ files, urlCount: urls.length }, null, 2), "utf8");
            const urlsPath = join(cacheDir, `${accession}_urls_${urls.length}.txt`);
            writeFileSync(urlsPath, urls.join("\n") + "\n", "utf8");
            base.sourceFile = cacheJson;
            base.urlCount = urls.length;
            base.rawUrlCount = urls.filter((u) => isRawUrl(u)).length;
            base.urlsFile = copyToUrlsDir(pmid, accession, organism, modification, urlsPath);
            base.notes = `jPOST API /_api/file target=public; files=${files.length}; storage=storage.jpostdb.org`;
            base.status = urls.length > 0 ? "ok" : "partial";
            return base;
        }
        if (repo === "PDC") {
            const out = runPdcExtract(accession, scripts);
            base.sourceFile = scripts.pdcExtract;
            base.urlCount = out.urls.length;
            base.rawUrlCount = out.rawUrlCount;
            base.urlsFile = copyToUrlsDir(pmid, accession, organism, modification, out.urlsFile);
            base.notes = `PDC CPTAC GraphQL; raw mass spectra proprietary`;
            base.status = out.urls.length > 0 ? "ok" : "partial";
            return base;
        }
        base.notes = `Unsupported repository for ${accession}`;
        base.error = `Unknown MS repository: ${repo}`;
        return base;
    }
    catch (err) {
        base.error = err instanceof Error ? err.message : String(err);
        return base;
    }
}
function copyToUrlsDir(pmid, accession, organism, modification, src) {
    const dest = join(stage6UrlsDir(), stage6UrlsBasename(pmid, accession, organism, modification));
    copyFileSync(src, dest);
    return dest;
}
function isRawUrl(url) {
    return /\.raw(?:\?|$)/i.test(url);
}
function rebuildStage6Outputs(results) {
    const header = [
        "PMID",
        "Title",
        "MS data source",
        "Identifier",
        "status",
        "accession",
        "repo",
        "organism",
        "modification",
        "urlCount",
        "rawUrlCount",
        "urlsFile",
        "notes",
        "error",
    ];
    const jobLines = [header.join(",")];
    const urlHeader = ["PMID", "accession", "repo", "url", "is_raw"];
    const urlLines = [urlHeader.join(",")];
    for (const r of results.slice().sort((a, b) => a.pmid.localeCompare(b.pmid))) {
        const pmidOut = pmidForOutput(r.pmid);
        for (const a of r.accessionResults) {
            jobLines.push([
                csvEscape(pmidOut),
                csvEscape(r.title),
                csvEscape(r.msDataSource),
                csvEscape(r.identifier),
                csvEscape(r.status),
                csvEscape(a.accession),
                csvEscape(a.repo),
                csvEscape(a.organism),
                csvEscape(a.modification),
                String(a.urlCount),
                String(a.rawUrlCount),
                csvEscape(a.urlsFile),
                csvEscape(a.notes),
                csvEscape(a.error ?? ""),
            ].join(","));
            if (a.urlsFile && existsSync(a.urlsFile)) {
                for (const url of readUrlFile(a.urlsFile)) {
                    urlLines.push([
                        csvEscape(pmidOut),
                        csvEscape(a.accession),
                        csvEscape(a.repo),
                        csvEscape(url),
                        isRawUrl(url) ? "true" : "false",
                    ].join(","));
                }
            }
        }
    }
    writeFileSync(stage6DownloadJobsPath(), jobLines.join("\n") + "\n", "utf8");
    writeFileSync(stage6UrlsAllPath(), urlLines.join("\n") + "\n", "utf8");
}
function readUrlFile(path) {
    return readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
}
export async function processPaper(pmid, title, organismRaw, ptmsRaw, msDataSource, identifier, getUrlDir) {
    const organism = shortOrganism(organismRaw);
    // Download URL basename uses one Modification tag (same rule as qratio PTMs column)
    const modification = shortModification(resolveSingleModification({ litPtms: ptmsRaw }));
    const ids = splitIdentifiers(identifier);
    const accessionResults = [];
    for (const accession of ids) {
        const repo = resolveRepo(accession, msDataSource);
        // PXD partner mirrors of an iProX deposit are not PRIDE FTP projects.
        // When native IPX IDs are present, skip PXD→PRIDE to avoid empty FTP lookups.
        const hasIproxNative = ids.some((id) => /^IPX\d+$/i.test(id));
        if (repo === "PRIDE" &&
            /^PXD\d+$/i.test(accession) &&
            (hasIproxNative || /\biprox\b/i.test(msDataSource))) {
            accessionResults.push({
                accession,
                repo: "PRIDE",
                status: "skipped",
                urlCount: 0,
                rawUrlCount: 0,
                sourceFile: "",
                urlsFile: "",
                organism,
                modification,
                notes: hasIproxNative
                    ? "Skipped PXD partner ID; resolving native IPX accession(s) instead"
                    : "Skipped PXD under msDataSource=iProX (not a PRIDE FTP dataset)",
            });
            continue;
        }
        const result = await extractAccession(pmid, accession, repo, ids, organism, modification, getUrlDir);
        accessionResults.push(result);
    }
    const totalUrls = accessionResults.reduce((n, a) => n + a.urlCount, 0);
    const totalRawUrls = accessionResults.reduce((n, a) => n + a.rawUrlCount, 0);
    return {
        pmid,
        title,
        msDataSource,
        identifier,
        status: aggregateStatus(accessionResults),
        accessionResults,
        totalUrls,
        totalRawUrls,
        extractedAt: new Date().toISOString(),
        error: ids.length === 0
            ? "Empty Identifier in literature_info"
            : accessionResults.every((a) => a.status === "error")
                ? accessionResults.map((a) => a.error).filter(Boolean).join("; ")
                : undefined,
    };
}
export async function runStage6DownloadUrls(options = {}) {
    const { limit = 20, all = false, concurrency = 2, pmid, resume = true, getUrlDir, onResult, onError, } = options;
    // Validate scripts early
    resolveGetUrlScripts(getUrlDir);
    const successRows = loadQratioSuccessCsv().filter((r) => r.status === "ok" && r.rowCount > 0);
    const litByPmid = new Map(loadLiteratureInfoCsv().map((r) => [r.pmid, r]));
    const done = resume ? loadStage6Done() : new Map();
    let jobs = successRows.map((s) => {
        const lit = litByPmid.get(s.pmid);
        return {
            pmid: s.pmid,
            title: lit?.title || s.title,
            organism: lit?.organism ?? "",
            ptms: lit?.ptms ?? "",
            msDataSource: lit?.msDataSource ?? "",
            identifier: lit?.identifier ?? "",
        };
    });
    if (pmid) {
        const inSuccess = jobs.some((j) => j.pmid === pmid);
        if (!inSuccess) {
            const lit = litByPmid.get(pmid);
            if (lit?.identifier.trim()) {
                jobs = [
                    {
                        pmid: lit.pmid,
                        title: lit.title,
                        organism: lit.organism,
                        ptms: lit.ptms,
                        msDataSource: lit.msDataSource,
                        identifier: lit.identifier,
                    },
                ];
            }
            else {
                jobs = jobs.filter((j) => j.pmid === pmid);
            }
        }
        else {
            jobs = jobs.filter((j) => j.pmid === pmid);
        }
    }
    else if (!all) {
        jobs = jobs.slice(0, limit);
    }
    const byStatus = {
        ok: 0,
        partial: 0,
        skipped: 0,
        error: 0,
    };
    let skippedDone = 0;
    let saved = 0;
    const pending = [];
    const allResults = new Map(done);
    const queue = jobs.filter((j) => {
        if (resume && done.has(j.pmid)) {
            skippedDone++;
            return false;
        }
        return true;
    });
    let index = 0;
    async function worker() {
        while (index < queue.length) {
            const i = index++;
            const job = queue[i];
            try {
                const result = await processPaper(job.pmid, job.title, job.organism, job.ptms, job.msDataSource, job.identifier, getUrlDir);
                pending.push(result);
                allResults.set(job.pmid, result);
                saved++;
                byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
                onResult?.(result, i, queue.length);
            }
            catch (err) {
                onError?.(job.pmid, err, i);
                const fail = {
                    pmid: job.pmid,
                    title: job.title,
                    msDataSource: job.msDataSource,
                    identifier: job.identifier,
                    status: "error",
                    accessionResults: [],
                    totalUrls: 0,
                    totalRawUrls: 0,
                    extractedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : String(err),
                };
                pending.push(fail);
                allResults.set(job.pmid, fail);
                saved++;
                byStatus.error++;
            }
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, () => worker());
    await Promise.all(workers);
    const merged = [...allResults.values()].sort((a, b) => a.pmid.localeCompare(b.pmid));
    writeFileSync(stage6ResultsJsonlPath(), merged.map((r) => JSON.stringify(r)).join("\n") + (merged.length ? "\n" : ""), "utf8");
    rebuildStage6Outputs(merged);
    const uniqueAccessions = new Set();
    let totalUrls = 0;
    let totalRawUrls = 0;
    for (const r of allResults.values()) {
        totalUrls += r.totalUrls;
        totalRawUrls += r.totalRawUrls;
        for (const a of r.accessionResults)
            uniqueAccessions.add(a.accession);
    }
    return {
        eligible: jobs.length,
        attempted: queue.length,
        saved,
        skippedDone,
        byStatus,
        totalUrls,
        totalRawUrls,
        uniqueAccessions: uniqueAccessions.size,
    };
}
export function stage6OutputPaths() {
    return {
        dir: join(stage6CacheDir(), ".."),
        results: stage6ResultsJsonlPath(),
        jobs: stage6DownloadJobsPath(),
        urlsAll: stage6UrlsAllPath(),
        urlsDir: stage6UrlsDir(),
        cache: stage6CacheDir(),
    };
}
/**
 * Standalone Stage-6 URL resolution for one or more MS accessions
 * (PXD / IPX / JPST / MSV / PDC) without a full PMID pipeline.
 */
export async function runResolveUrlsByAccession(options) {
    const log = options.onLog ?? (() => { });
    const accessions = [
        ...new Set((options.accessions || [])
            .map((a) => String(a || "").trim().toUpperCase())
            .filter(Boolean)),
    ];
    if (accessions.length === 0) {
        throw new Error("resolve-urls requires at least one --accession (e.g. PXD012345)");
    }
    const unknown = accessions.filter((id) => repoFromAccession(id) === "unknown");
    if (unknown.length > 0) {
        throw new Error(`Unrecognized accession(s): ${unknown.join(", ")}. ` +
            `Expected PXD… / IPX… / JPST… / MSV… / PDC…`);
    }
    resolveGetUrlScripts(options.getUrlDir);
    // PMID must be a real PubMed ID — never fall back to the accession (PXD/IPX/…).
    const pmid = pmidForOutput(options.pmid);
    const identifier = accessions.join("; ");
    const title = options.title?.trim() || `Direct resolve: ${identifier}`;
    const organism = options.organism?.trim() || "";
    const ptms = options.modification?.trim() || "";
    const msDataSource = options.msDataSource?.trim() ||
        [...new Set(accessions.map((id) => repoFromAccession(id)))].join("; ");
    log(`Resolving download URLs for ${identifier}…`);
    const result = await processPaper(pmid, title, organism, ptms, msDataSource, identifier, options.getUrlDir);
    writeFileSync(stage6ResultsJsonlPath(), JSON.stringify(result) + "\n", "utf8");
    rebuildStage6Outputs([result]);
    const urlsPath = stage6UrlsAllPath();
    log(`Wrote ${result.totalUrls} URL(s) → ${urlsPath}`);
    const byStatus = {
        ok: 0,
        partial: 0,
        skipped: 0,
        error: 0,
    };
    byStatus[result.status] = 1;
    return {
        eligible: 1,
        attempted: 1,
        saved: 1,
        skippedDone: 0,
        byStatus,
        totalUrls: result.totalUrls,
        totalRawUrls: result.totalRawUrls,
        uniqueAccessions: accessions.length,
        accessions,
        results: [result],
        urlsPath,
    };
}
