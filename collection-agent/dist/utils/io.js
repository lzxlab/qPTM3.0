import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildConditionSampleMap } from "../stage5/sample-map.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Project root = CollectionAgent/ */
export function projectRoot() {
    return resolve(__dirname, "../..");
}
/** Default pipeline data root: `<project>/data` */
export function defaultDataRoot() {
    return join(projectRoot(), "data");
}
/**
 * Optional override for stage outputs (and abstracts cache).
 * e.g. setDataRoot("validation") → validation/stage1 … validation/stage5
 */
let overrideDataRoot = null;
export function setDataRoot(root) {
    if (!root || !String(root).trim()) {
        overrideDataRoot = null;
        return dataRoot();
    }
    const raw = String(root).trim();
    overrideDataRoot = isAbsolute(raw) ? resolve(raw) : resolve(projectRoot(), raw);
    if (!existsSync(overrideDataRoot))
        mkdirSync(overrideDataRoot, { recursive: true });
    return overrideDataRoot;
}
export function dataRoot() {
    return overrideDataRoot ?? defaultDataRoot();
}
export function isCustomDataRoot() {
    return overrideDataRoot != null;
}
export function abstractsDir() {
    const dir = join(dataRoot(), "abstracts");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function literatureInfoPath() {
    const curated = join(projectRoot(), "files", "qPTM3_109pmids.csv");
    if (existsSync(curated))
        return curated;
    return join(projectRoot(), "0_literature_info.csv");
}
/** Store paths relative to project root when possible (portable across machines). */
export function toPortablePath(absPath) {
    if (!absPath)
        return absPath;
    const root = projectRoot();
    const normalized = resolve(absPath);
    if (normalized === root || normalized.startsWith(root + sep)) {
        return relative(root, normalized);
    }
    return absPath;
}
/** Resolve a path stored in JSON/CSV (relative to project root or absolute legacy). */
export function resolvePortablePath(stored) {
    if (!stored)
        return stored;
    if (isAbsolute(stored))
        return stored;
    return resolve(projectRoot(), stored);
}
export function stage1Dir() {
    const dir = join(dataRoot(), "stage1");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
/** @deprecated use stage1Dir() */
export function screenedDir() {
    return stage1Dir();
}
export function stage2Dir() {
    const dir = join(dataRoot(), "stage2");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage2ManifestJsonlPath() {
    return join(stage2Dir(), "manifest.jsonl");
}
export function stage2ResultsCsvPath() {
    return join(stage2Dir(), "stage2_results.csv");
}
export function stage2ManualQueuePath() {
    return join(stage2Dir(), "manual_queue.csv");
}
export function stage2FulltextDir() {
    const dir = join(stage2Dir(), "fulltext");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage2FulltextManifestPath() {
    return join(stage2Dir(), "fulltext_manifest.jsonl");
}
export function stage2FulltextResultsCsvPath() {
    return join(stage2Dir(), "fulltext_results.csv");
}
export function stage2FulltextManualQueuePath() {
    return join(stage2Dir(), "fulltext_manual_queue.csv");
}
export function stage3Dir() {
    const dir = join(dataRoot(), "stage3");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage3ResultsJsonlPath() {
    return join(stage3Dir(), "stage3_results.jsonl");
}
export function stage3ResultsCsvPath() {
    return join(stage3Dir(), "stage3_results.csv");
}
/** Canonical literature_info export (aligned with files/qPTM3_109pmids.csv columns) */
export function stage3LiteratureInfoPath() {
    return join(stage3Dir(), "literature_info.csv");
}
export function stage3ManualQueuePath() {
    return join(stage3Dir(), "manual_queue.csv");
}
export function stage4Dir() {
    const dir = join(dataRoot(), "stage4");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage4SuppDir() {
    const dir = join(stage4Dir(), "supp");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage4SuppScoutJsonlPath() {
    return join(stage4Dir(), "supp_scout.jsonl");
}
export function stage4SuppScoutCsvPath() {
    return join(stage4Dir(), "supp_scout.csv");
}
export function stage4SuppJobsPath() {
    return join(stage4Dir(), "supp_jobs.jsonl");
}
export function stage4ManualQueuePath() {
    return join(stage4Dir(), "manual_queue.csv");
}
export function stage5Dir() {
    const dir = join(dataRoot(), "stage5");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage5InventoryDir() {
    const dir = join(stage5Dir(), "inventory");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage5WorkDir() {
    const dir = join(stage5Dir(), "work");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage5ResultsJsonlPath() {
    return join(stage5Dir(), "stage5_results.jsonl");
}
export function stage5QratioCsvPath() {
    return join(stage5Dir(), "qratio.csv");
}
export function stage5ProteomeCsvPath() {
    return join(stage5Dir(), "protein_qratio.csv");
}
export function stage5ParseReportPath() {
    return join(stage5Dir(), "parse_report.csv");
}
export function stage5ManualQueuePath() {
    return join(stage5Dir(), "manual_queue.csv");
}
/** Papers that successfully entered qratio (status=ok, rowCount>0) */
export function stage5QratioSuccessPath() {
    return join(stage5Dir(), "qratio_success.csv");
}
export function stage5QcResultsPath() {
    return join(stage5Dir(), "qc_results.csv");
}
export function stage5IntensityQueuePath() {
    return join(stage5Dir(), "intensity_queue.csv");
}
export function writeCsvRows(path, rows) {
    const lines = rows.map((row) => row.map((cell) => csvEscape(cell)).join(","));
    writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}
/** Keep one row per PMID; last row wins unless preferLatestColumn is set (lexicographic compare). */
export function dedupeCsvFileByPmid(path, opts) {
    if (!existsSync(path))
        return { before: 0, after: 0, removed: 0 };
    const rows = parseCsv(readFileSync(path, "utf8"));
    if (rows.length <= 1) {
        const n = Math.max(0, rows.length - 1);
        return { before: n, after: n, removed: 0 };
    }
    const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    const pmidIdx = header.findIndex((h) => /^pmid$/i.test(h));
    if (pmidIdx < 0) {
        const before = rows.length - 1;
        return { before, after: before, removed: 0 };
    }
    const sortIdx = opts?.preferLatestColumn
        ? header.findIndex((h) => h.toLowerCase() === opts.preferLatestColumn.toLowerCase())
        : -1;
    const byPmid = new Map();
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const pmid = (cols[pmidIdx] ?? "").trim();
        if (!pmid)
            continue;
        const prev = byPmid.get(pmid);
        if (!prev) {
            byPmid.set(pmid, cols);
            continue;
        }
        if (sortIdx >= 0) {
            const prevTs = prev[sortIdx] ?? "";
            const curTs = cols[sortIdx] ?? "";
            if (curTs >= prevTs)
                byPmid.set(pmid, cols);
        }
        else {
            byPmid.set(pmid, cols);
        }
    }
    const sorted = [...byPmid.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const out = [rows[0], ...sorted.map(([, cols]) => cols)];
    const before = rows.length - 1;
    const after = sorted.length;
    if (before !== after)
        writeCsvRows(path, out);
    return { before, after, removed: before - after };
}
export function stage6Dir() {
    const dir = join(dataRoot(), "stage6");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage6CacheDir() {
    const dir = join(stage6Dir(), "cache");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage6UrlsDir() {
    const dir = join(stage6Dir(), "urls");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function stage6ResultsJsonlPath() {
    return join(stage6Dir(), "stage6_results.jsonl");
}
export function stage6DownloadJobsPath() {
    return join(stage6Dir(), "download_jobs.csv");
}
export function stage6UrlsAllPath() {
    return join(stage6Dir(), "urls_all.csv");
}
export function loadQratioSuccessCsv(path = stage5QratioSuccessPath()) {
    if (!existsSync(path))
        return [];
    const rows = parseCsv(readFileSync(path, "utf8"));
    if (rows.length === 0)
        return [];
    const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const pmidIdx = idx("PMID");
    const titleIdx = idx("Title");
    const statusIdx = idx("status");
    const rowCountIdx = idx("rowCount");
    const proteomeIdx = idx("proteomeRowCount");
    if (pmidIdx < 0)
        throw new Error(`Invalid qratio_success CSV (missing PMID): ${path}`);
    const byPmid = new Map();
    const parsedAtIdx = idx("parsedAt");
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const pmid = (cols[pmidIdx] ?? "").trim();
        if (!pmid)
            continue;
        const row = {
            pmid,
            title: titleIdx >= 0 ? (cols[titleIdx] ?? "").trim() : "",
            status: statusIdx >= 0 ? (cols[statusIdx] ?? "").trim() : "",
            rowCount: rowCountIdx >= 0 ? Number(cols[rowCountIdx] ?? 0) || 0 : 0,
            proteomeRowCount: proteomeIdx >= 0 ? Number(cols[proteomeIdx] ?? 0) || 0 : 0,
        };
        const parsedAt = parsedAtIdx >= 0 ? (cols[parsedAtIdx] ?? "").trim() : "";
        const prev = byPmid.get(pmid);
        if (!prev || parsedAt >= prev.parsedAt)
            byPmid.set(pmid, { row, parsedAt });
    }
    return [...byPmid.values()].map((e) => e.row).sort((a, b) => a.pmid.localeCompare(b.pmid));
}
/** Load canonical Stage3 literature_info.csv (subset of columns used by Stage6). */
export function loadLiteratureInfoCsv(path = stage3LiteratureInfoPath()) {
    if (!existsSync(path))
        return [];
    const rows = parseCsv(readFileSync(path, "utf8"));
    if (rows.length === 0)
        return [];
    const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const pmidIdx = idx("PMID");
    const titleIdx = idx("Title");
    const orgIdx = idx("Organism");
    const ptmsIdx = idx("PTMs");
    const srcIdx = idx("MS data source");
    const idIdx = idx("Identifier");
    if (pmidIdx < 0)
        throw new Error(`Invalid literature_info CSV (missing PMID): ${path}`);
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const pmid = (cols[pmidIdx] ?? "").trim();
        if (!pmid)
            continue;
        out.push({
            pmid,
            title: titleIdx >= 0 ? (cols[titleIdx] ?? "").trim() : "",
            organism: orgIdx >= 0 ? (cols[orgIdx] ?? "").trim() : "",
            ptms: ptmsIdx >= 0 ? (cols[ptmsIdx] ?? "").trim() : "",
            msDataSource: srcIdx >= 0 ? (cols[srcIdx] ?? "").trim() : "",
            identifier: idIdx >= 0 ? (cols[idIdx] ?? "").trim() : "",
        });
    }
    return out;
}
export function includePmidsCsvPath() {
    return join(stage1Dir(), "stage1_include_pmids.csv");
}
export function resultsJsonlPath() {
    return join(stage1Dir(), "stage1_results.jsonl");
}
export function resultsCsvPath() {
    return join(stage1Dir(), "stage1_results.csv");
}
/** Decode buffer: UTF-8 first, then gb18030 for PubMed CN exports */
export function decodeBuffer(buf) {
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        return buf.subarray(3).toString("utf8");
    }
    const asUtf8 = buf.toString("utf8");
    if (!asUtf8.includes("\uFFFD"))
        return asUtf8;
    try {
        return new TextDecoder("gb18030").decode(buf);
    }
    catch {
        return asUtf8;
    }
}
export function readTextFile(path) {
    return decodeBuffer(readFileSync(path));
}
/** Minimal CSV parser supporting quoted fields with commas/newlines */
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (inQuotes) {
            if (c === '"' && next === '"') {
                field += '"';
                i++;
            }
            else if (c === '"') {
                inQuotes = false;
            }
            else {
                field += c;
            }
            continue;
        }
        if (c === '"') {
            inQuotes = true;
        }
        else if (c === ",") {
            row.push(field);
            field = "";
        }
        else if (c === "\n") {
            row.push(field);
            field = "";
            if (row.some((x) => x.length > 0))
                rows.push(row);
            row = [];
        }
        else if (c !== "\r") {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        if (row.some((x) => x.length > 0))
            rows.push(row);
    }
    return rows;
}
export function parseAbstractCsv(text, sourceFile) {
    const rows = parseCsv(text);
    if (rows.length === 0)
        return [];
    const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    const pmidIdx = header.findIndex((h) => /^pmid$/i.test(h));
    const titleIdx = header.findIndex((h) => /^title$/i.test(h));
    const absIdx = header.findIndex((h) => /^abstract$/i.test(h));
    if (pmidIdx < 0 || titleIdx < 0 || absIdx < 0) {
        throw new Error(`Invalid abstract CSV header in ${sourceFile}: ${header.join(",")}`);
    }
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const pmid = (cols[pmidIdx] ?? "").trim();
        if (!pmid)
            continue;
        out.push({
            pmid,
            title: (cols[titleIdx] ?? "").trim(),
            abstract: (cols[absIdx] ?? "").trim(),
            sourceFile,
        });
    }
    return out;
}
export function loadGoldPmids() {
    if (!existsSync(literatureInfoPath()))
        return new Set();
    const text = readTextFile(literatureInfoPath());
    const rows = parseCsv(text);
    if (rows.length === 0)
        return new Set();
    const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    const idx = header.findIndex((h) => /^pmid$/i.test(h));
    if (idx < 0)
        return new Set();
    const set = new Set();
    for (let i = 1; i < rows.length; i++) {
        const pmid = (rows[i][idx] ?? "").trim();
        if (pmid)
            set.add(pmid);
    }
    return set;
}
export function loadAllAbstracts() {
    const byPmid = new Map();
    // Production abstracts as shared cache when --out-dir redirects writes
    const dirs = [];
    if (isCustomDataRoot()) {
        const prod = join(defaultDataRoot(), "abstracts");
        if (existsSync(prod))
            dirs.push(prod);
    }
    const primary = abstractsDir();
    if (!dirs.includes(primary))
        dirs.push(primary);
    for (const dir of dirs) {
        if (!existsSync(dir))
            continue;
        const files = readdirSync(dir).filter((f) => f.endsWith(".csv"));
        for (const file of files) {
            const records = parseAbstractCsv(readTextFile(join(dir, file)), file);
            for (const r of records) {
                // Later dirs (out-dir) override earlier (production)
                byPmid.set(r.pmid, r);
            }
        }
    }
    return [...byPmid.values()];
}
export function loadScreenedPmids() {
    const path = resultsJsonlPath();
    if (!existsSync(path))
        return new Set();
    const set = new Set();
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const obj = JSON.parse(t);
            if (obj.pmid)
                set.add(obj.pmid);
        }
        catch {
            // skip bad lines
        }
    }
    return set;
}
export function loadAllScreenResults() {
    const path = resultsJsonlPath();
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
export function appendScreenResults(results) {
    const path = resultsJsonlPath();
    appendFileSync(path, results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    rebuildResultsCsv();
}
export function writeAllScreenResults(results) {
    const path = resultsJsonlPath();
    writeFileSync(path, results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    rebuildResultsCsv();
}
/** Drop prior Stage-1 decisions for the given PMIDs (for --rescreen). */
export function removeScreenResultsForPmids(pmids, options = {}) {
    const drop = new Set([...pmids].map((p) => String(p).trim()).filter(Boolean));
    if (drop.size === 0)
        return 0;
    const before = loadAllScreenResults();
    const kept = before.filter((r) => !drop.has(r.pmid));
    const removed = before.length - kept.length;
    if (removed > 0) {
        writeAllScreenResults(kept);
        // Defer include/uncertain CSV refresh until rescreen completes (see runStage1Screen).
        if (options.refreshExports !== false) {
            exportIncludePmidsCsv();
            exportUncertainPmidsCsv();
        }
    }
    return removed;
}
/** Parse PMID,decision[,note] CSV from manual review */
export function parseManualReviewCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0)
        return [];
    const rows = [];
    const start = /^pmid/i.test(lines[0]) ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line)
            continue;
        const [pmid, decision, ...noteParts] = line.split(",");
        const d = decision?.trim().toLowerCase();
        if (!pmid?.trim() || (d !== "include" && d !== "exclude" && d !== "uncertain")) {
            throw new Error(`Invalid review row ${i + 1}: ${line}`);
        }
        rows.push({
            pmid: pmid.trim(),
            decision: d,
            note: noteParts.join(",").trim() || undefined,
        });
    }
    return rows;
}
export function applyManualReviews(reviews) {
    const byPmid = new Map(reviews.map((r) => [r.pmid, r]));
    const results = loadAllScreenResults();
    const missing = [];
    let updated = 0;
    const reviewedAt = new Date().toISOString();
    for (const r of results) {
        const review = byPmid.get(r.pmid);
        if (!review)
            continue;
        byPmid.delete(r.pmid);
        const tag = `[manual review → ${review.decision}]`;
        r.decision = review.decision;
        r.confidence = 1;
        r.reason = review.note
            ? `${review.note} ${tag}`
            : r.reason.includes(tag)
                ? r.reason
                : `${r.reason} ${tag}`;
        r.manualReviewedAt = reviewedAt;
        updated++;
    }
    for (const pmid of byPmid.keys())
        missing.push(pmid);
    writeAllScreenResults(results);
    return { updated, missing };
}
export function exportIncludePmidsCsv() {
    const abstracts = new Map(loadAllAbstracts().map((a) => [a.pmid, a.abstract]));
    const results = loadAllScreenResults().filter((r) => r.decision === "include");
    const header = [
        "PMID",
        "Title",
        "Abstract",
        "confidence",
        "ptmTypes",
        "organisms",
        "isQuantitativeMs",
        "hasSiteLevelDataHint",
        "quantificationMethods",
        "dataSourceHint",
        "reason",
        "sourceFile",
        "screenedAt",
        "manualReviewedAt",
    ];
    const lines = [header.join(",")];
    for (const r of results) {
        lines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            csvEscape(abstracts.get(r.pmid) ?? ""),
            String(r.confidence),
            csvEscape(r.ptmTypes.join(";")),
            csvEscape(r.organisms.join(";")),
            String(r.isQuantitativeMs),
            String(r.hasSiteLevelDataHint),
            csvEscape(r.quantificationMethods.join(";")),
            csvEscape(r.dataSourceHint),
            csvEscape(r.reason),
            csvEscape(r.sourceFile),
            csvEscape(r.screenedAt),
            csvEscape(r.manualReviewedAt ?? ""),
        ].join(","));
    }
    const out = join(stage1Dir(), "stage1_include_pmids.csv");
    writeFileSync(out, lines.join("\n") + "\n", "utf8");
    return results.length;
}
/**
 * Write Stage-2 input include list from abstracts (bypass ScreenChain).
 * Include CSV is exactly `records` (for validation Stage2–5).
 * Also upserts stage1_results as include with a force-include reason.
 */
export function writeForceIncludeFromAbstracts(records, opts = {}) {
    const reason = opts.reason ?? "force-include (validation / bypass Stage-1 screen)";
    const now = new Date().toISOString();
    const byPmid = new Map(loadAllScreenResults().map((r) => [r.pmid, r]));
    for (const a of records) {
        byPmid.set(a.pmid, {
            pmid: a.pmid,
            title: a.title,
            decision: "include",
            confidence: 1,
            ptmTypes: [],
            organisms: [],
            isQuantitativeMs: true,
            hasSiteLevelDataHint: true,
            quantificationMethods: [],
            dataSourceHint: "unknown",
            reason,
            sourceFile: a.sourceFile || "force-include",
            screenedAt: now,
            manualReviewedAt: now,
        });
    }
    writeAllScreenResults([...byPmid.values()]);
    const header = [
        "PMID",
        "Title",
        "Abstract",
        "confidence",
        "ptmTypes",
        "organisms",
        "isQuantitativeMs",
        "hasSiteLevelDataHint",
        "quantificationMethods",
        "dataSourceHint",
        "reason",
        "sourceFile",
        "screenedAt",
        "manualReviewedAt",
    ];
    const lines = [header.join(",")];
    for (const a of records) {
        lines.push([
            csvEscape(a.pmid),
            csvEscape(a.title),
            csvEscape(a.abstract),
            "1",
            "",
            "",
            "true",
            "true",
            "",
            "unknown",
            csvEscape(reason),
            csvEscape(a.sourceFile || "force-include"),
            csvEscape(now),
            csvEscape(now),
        ].join(","));
    }
    const out = includePmidsCsvPath();
    writeFileSync(out, lines.join("\n") + "\n", "utf8");
    exportUncertainPmidsCsv();
    return { includeN: records.length, path: out };
}
export function loadIncludePmidsCsv(path = includePmidsCsvPath()) {
    if (!existsSync(path))
        return [];
    const rows = parseCsv(readFileSync(path, "utf8"));
    if (rows.length === 0)
        return [];
    const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const pmidIdx = idx("PMID");
    const titleIdx = idx("Title");
    const absIdx = idx("Abstract");
    const confIdx = idx("confidence");
    const hintIdx = idx("dataSourceHint");
    const reasonIdx = idx("reason");
    const srcIdx = idx("sourceFile");
    if (pmidIdx < 0)
        throw new Error(`Invalid include CSV (missing PMID): ${path}`);
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const pmid = (cols[pmidIdx] ?? "").trim();
        if (!pmid)
            continue;
        out.push({
            pmid,
            title: (cols[titleIdx] ?? "").trim(),
            abstract: absIdx >= 0 ? (cols[absIdx] ?? "").trim() : "",
            confidence: confIdx >= 0 ? Number(cols[confIdx] ?? 0) || 0 : 0,
            dataSourceHint: hintIdx >= 0 ? (cols[hintIdx] ?? "unknown").trim() || "unknown" : "unknown",
            reason: reasonIdx >= 0 ? (cols[reasonIdx] ?? "").trim() : "",
            sourceFile: srcIdx >= 0 ? (cols[srcIdx] ?? "").trim() : "",
        });
    }
    return out;
}
export function exportUncertainPmidsCsv() {
    const results = loadAllScreenResults().filter((r) => r.decision === "uncertain");
    const header = ["PMID", "Title", "confidence", "reason"];
    const lines = [header.join(",")];
    for (const r of results) {
        lines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            String(r.confidence),
            csvEscape(r.reason),
        ].join(","));
    }
    const out = join(stage1Dir(), "stage1_uncertain_pmids.csv");
    writeFileSync(out, lines.join("\n") + "\n", "utf8");
    return results.length;
}
export function rebuildResultsCsv() {
    const results = loadAllScreenResults();
    const header = [
        "PMID",
        "Title",
        "decision",
        "confidence",
        "ptmTypes",
        "organisms",
        "isQuantitativeMs",
        "hasSiteLevelDataHint",
        "quantificationMethods",
        "dataSourceHint",
        "reason",
        "sourceFile",
        "screenedAt",
    ];
    const lines = [header.join(",")];
    for (const r of results) {
        lines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            csvEscape(r.decision),
            String(r.confidence),
            csvEscape(r.ptmTypes.join(";")),
            csvEscape(r.organisms.join(";")),
            String(r.isQuantitativeMs),
            String(r.hasSiteLevelDataHint),
            csvEscape(r.quantificationMethods.join(";")),
            csvEscape(r.dataSourceHint),
            csvEscape(r.reason),
            csvEscape(r.sourceFile),
            csvEscape(r.screenedAt),
        ].join(","));
    }
    writeFileSync(resultsCsvPath(), lines.join("\n") + "\n", "utf8");
}
export function csvEscape(v) {
    if (/[",\n\r]/.test(v))
        return `"${v.replace(/"/g, '""')}"`;
    return v;
}
export function loadStage3Results() {
    const path = stage3ResultsJsonlPath();
    if (!existsSync(path))
        return [];
    const out = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            const row = JSON.parse(t);
            // Always sanitize: drop Cond=>Sample collisions (multi-sample shared contrast)
            row.conditionSampleMap = buildConditionSampleMap(row.sample || "", row.condition || "", row.conditionSampleMap || "");
            out.push(row);
        }
        catch {
            // skip
        }
    }
    return out;
}
/** PMIDs with a successful Stage3 extraction (errors remain retriable). */
export function loadStage3DonePmids() {
    return new Set(loadStage3Results()
        .filter((r) => r.status === "ok" || r.status === "partial")
        .map((r) => r.pmid)
        .filter(Boolean));
}
/** Latest Stage3 result for one PMID (includes error shells). */
export function loadStage3ResultForPmid(pmid) {
    const want = (pmid || "").trim();
    if (!want)
        return null;
    const all = loadStage3Results();
    for (let i = all.length - 1; i >= 0; i--) {
        if (all[i].pmid === want)
            return all[i];
    }
    return null;
}
/** Map LiteratureInfoRow → UI / literature_info column names. */
export function literatureInfoToDisplayRow(r) {
    return {
        PMID: r.pmid || "",
        Title: r.title || "",
        Sample: r.sample || "",
        "Sample type": r.sampleType || "",
        Organism: r.organism || "",
        PTMs: r.ptms || "",
        "Label method": r.labelMethod || "",
        Condition: r.condition || "",
        "Detail condition": r.detailCondition || "",
        "Condition-Sample map": r.conditionSampleMap || "",
        "Enrichment method": r.enrichmentMethod || "",
        "Mass spectrometer": r.massSpectrometer || "",
        "MS data source": r.msDataSource || "",
        Identifier: r.identifier || "",
        status: r.status || "",
        notes: r.notes || "",
        error: r.error || "",
    };
}
export function appendStage3Results(rows) {
    if (rows.length === 0)
        return;
    // Upsert by PMID so Stage3 retries replace prior error shells instead of stacking.
    const byPmid = new Map();
    for (const r of loadStage3Results()) {
        if (r.pmid)
            byPmid.set(r.pmid, r);
    }
    for (const r of rows) {
        if (r.pmid)
            byPmid.set(r.pmid, r);
    }
    stage3Dir();
    writeFileSync(stage3ResultsJsonlPath(), [...byPmid.values()].map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    rebuildStage3Outputs();
}
/** Rebuild CSV + literature_info + manual queue from full JSONL. */
export function rebuildStage3Outputs() {
    stage3Dir();
    const results = loadStage3Results();
    const detailHeader = [
        "PMID",
        "Title",
        "Sample",
        "Sample type",
        "Organism",
        "PTMs",
        "Label method",
        "Condition",
        "Detail condition",
        "Condition-Sample map",
        "Enrichment method",
        "Mass spectrometer",
        "MS data source",
        "Identifier",
        "status",
        "confidence",
        "textSource",
        "notes",
        "extractedAt",
        "error",
    ];
    const detailLines = [detailHeader.join(",")];
    for (const r of results) {
        detailLines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            csvEscape(r.sample),
            csvEscape(r.sampleType),
            csvEscape(r.organism),
            csvEscape(r.ptms),
            csvEscape(r.labelMethod),
            csvEscape(r.condition),
            csvEscape(r.detailCondition),
            csvEscape(r.conditionSampleMap || ""),
            csvEscape(r.enrichmentMethod),
            csvEscape(r.massSpectrometer),
            csvEscape(r.msDataSource),
            csvEscape(r.identifier),
            csvEscape(r.status),
            String(r.confidence),
            csvEscape(r.textSource),
            csvEscape(r.notes),
            csvEscape(r.extractedAt),
            csvEscape(r.error ?? ""),
        ].join(","));
    }
    writeFileSync(stage3ResultsCsvPath(), detailLines.join("\n") + "\n", "utf8");
    const litHeader = [
        "PMID",
        "Title",
        "Sample",
        "Sample type",
        "Organism",
        "PTMs",
        "Label method",
        "Condition",
        "Detail condition",
        "Condition-Sample map",
        "Enrichment method",
        "Mass spectrometer",
        "MS data source",
        "Identifier",
    ];
    const litLines = [litHeader.join(",")];
    for (const r of results.filter((x) => x.status !== "error")) {
        litLines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            csvEscape(r.sample),
            csvEscape(r.sampleType),
            csvEscape(r.organism),
            csvEscape(r.ptms),
            csvEscape(r.labelMethod),
            csvEscape(r.condition),
            csvEscape(r.detailCondition),
            csvEscape(r.conditionSampleMap || ""),
            csvEscape(r.enrichmentMethod),
            csvEscape(r.massSpectrometer),
            csvEscape(r.msDataSource),
            csvEscape(r.identifier),
        ].join(","));
    }
    writeFileSync(stage3LiteratureInfoPath(), litLines.join("\n") + "\n", "utf8");
    const manual = results.filter((r) => r.status === "error" ||
        r.status === "partial" ||
        r.confidence < 0.6 ||
        (!r.condition && !r.ptms));
    const mHeader = [
        "PMID",
        "Title",
        "status",
        "confidence",
        "textSource",
        "PTMs",
        "Label method",
        "Condition",
        "Identifier",
        "notes",
        "error",
    ];
    const mLines = [mHeader.join(",")];
    for (const r of manual) {
        mLines.push([
            csvEscape(r.pmid),
            csvEscape(r.title),
            csvEscape(r.status),
            String(r.confidence),
            csvEscape(r.textSource),
            csvEscape(r.ptms),
            csvEscape(r.labelMethod),
            csvEscape(r.condition),
            csvEscape(r.identifier),
            csvEscape(r.notes),
            csvEscape(r.error ?? ""),
        ].join(","));
    }
    writeFileSync(stage3ManualQueuePath(), mLines.join("\n") + "\n", "utf8");
}
export function computeStats() {
    const abstracts = loadAllAbstracts();
    const screened = loadAllScreenResults();
    const screenedSet = new Set(screened.map((r) => r.pmid));
    const gold = loadGoldPmids();
    const pending = abstracts.filter((a) => !screenedSet.has(a.pmid));
    return {
        totalAbstracts: abstracts.length,
        uniquePmids: abstracts.length,
        alreadyScreened: screened.length,
        pending: pending.length,
        include: screened.filter((r) => r.decision === "include").length,
        exclude: screened.filter((r) => r.decision === "exclude").length,
        uncertain: screened.filter((r) => r.decision === "uncertain").length,
        goldOverlapPending: pending.filter((a) => gold.has(a.pmid)).length,
    };
}
