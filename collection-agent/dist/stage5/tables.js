/**
 * Stage 5 — inventory tabular files inside Stage-4 supplementary ZIPs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import XLSX from "xlsx";
import { listZipEntries } from "../stage4/zip.js";
import { parseCsv } from "../utils/io.js";
export const TABLE_EXTS = new Set([".xlsx", ".xls", ".csv", ".tsv", ".txt"]);
const MAX_CANDIDATE_FILES = 10;
const MAX_SHEETS_PER_FILE = 40;
/**
 * Resolve a column hint against sheet headers.
 * Supports exact/case-insensitive names and positional aliases from user/LLM
 * hints: `col_1`, `col1`, `column 1`, `column_1` → headers[0].
 */
export function resolveColumnIndex(headers, name) {
    if (!name || !headers.length)
        return -1;
    const exact = headers.findIndex((h) => h === name);
    if (exact >= 0)
        return exact;
    const lower = name.toLowerCase();
    const ci = headers.findIndex((h) => (h || "").toLowerCase() === lower);
    if (ci >= 0)
        return ci;
    const m = String(name)
        .trim()
        .match(/^(?:col(?:umn)?[\s._-]*)(\d+)$/i);
    if (m) {
        const idx = Number(m[1]) - 1;
        if (Number.isInteger(idx) && idx >= 0 && idx < headers.length)
            return idx;
    }
    return -1;
}
/** Like resolveColumnIndex, but returns the real header string (or null). */
export function resolveColumnName(headers, name) {
    const i = resolveColumnIndex(headers, name);
    return i >= 0 ? headers[i] : null;
}
const PREVIEW_ROWS = 5;
/** Cap rows loaded for parsing (per sheet). Long-format PTM tables can exceed 100k. */
export const MAX_PARSE_ROWS = 600_000;
function isTableEntry(path) {
    const base = basename(path);
    if (base.startsWith(".") || base.startsWith("__MACOSX"))
        return false;
    const ext = extname(base).toLowerCase();
    return TABLE_EXTS.has(ext);
}
function scoreTableEntry(entry) {
    const name = basename(entry.path).toLowerCase();
    let score = 0;
    if (/\.(xlsx|xls)$/i.test(name))
        score += 3;
    else if (/\.(csv|tsv)$/i.test(name))
        score += 2;
    else if (/\.txt$/i.test(name))
        score += 1;
    if (/site|phospho|ptm|modif|ubiquit|acetyl|glyco|sumo|ratio|quant/i.test(name))
        score += 4;
    if (/table|supp|mmc|dataset|peptide|protein/i.test(name))
        score += 1;
    if (entry.size > 5_000)
        score += 1;
    if (entry.size > 50_000)
        score += 1;
    return score;
}
export function pickCandidateEntries(zipPath, limit = MAX_CANDIDATE_FILES, forceIncludePaths = []) {
    const entries = listZipEntries(zipPath).filter((e) => isTableEntry(e.path));
    const ranked = entries
        .map((e) => ({ e, score: scoreTableEntry(e) }))
        .sort((a, b) => b.score - a.score || b.e.size - a.e.size);
    const picked = [];
    const seen = new Set();
    const push = (e) => {
        const key = e.path.replace(/\\/g, "/").toLowerCase();
        if (seen.has(key))
            return;
        seen.add(key);
        picked.push(e);
    };
    const matchesForce = (path) => {
        if (!forceIncludePaths.length)
            return false;
        const ep = path.replace(/\\/g, "/").toLowerCase();
        const base = basename(ep);
        return forceIncludePaths.some((f) => {
            const ff = (f || "").replace(/\\/g, "/").toLowerCase().trim();
            if (!ff)
                return false;
            return ff === ep || ep.endsWith("/" + ff) || ff.endsWith("/" + ep) || basename(ff) === base;
        });
    };
    // Always keep user-forced paths even when they fall outside the Top-N score window.
    for (const { e } of ranked) {
        if (matchesForce(e.path))
            push(e);
    }
    // Fill remaining slots with top-scored tabular files.
    for (const { e } of ranked) {
        if (picked.length >= limit)
            break;
        push(e);
    }
    return picked;
}
/** Extract selected ZIP entries into destDir (preserves entry relative paths). */
export function extractZipEntries(zipPath, entryPaths, destDir) {
    if (entryPaths.length === 0)
        return;
    mkdirSync(destDir, { recursive: true });
    // unzip can take multiple members; batch to avoid huge argv
    const batch = 20;
    for (let i = 0; i < entryPaths.length; i += batch) {
        const slice = entryPaths.slice(i, i + batch);
        execFileSync("unzip", ["-o", "-q", zipPath, ...slice, "-d", destDir], {
            maxBuffer: 40 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
}
function walkFiles(dir) {
    if (!existsSync(dir))
        return [];
    const out = [];
    const stack = [dir];
    while (stack.length > 0) {
        const cur = stack.pop();
        for (const name of readdirSync(cur)) {
            const p = join(cur, name);
            if (statSync(p).isDirectory())
                stack.push(p);
            else
                out.push(p);
        }
    }
    return out;
}
function resolveExtractedPath(destDir, entryPath) {
    const direct = join(destDir, entryPath);
    if (existsSync(direct))
        return direct;
    const base = basename(entryPath);
    for (const p of walkFiles(destDir)) {
        if (basename(p) === base)
            return p;
    }
    return null;
}
const HEADER_SCAN_ROWS = 30;
/** Pathological sheets with thousands of columns — keep mapping tractable */
const MAX_HEADER_COLS = 400;
function scoreHeaderRow(row) {
    const cells = row.map((c) => String(c ?? "").trim());
    const filled = cells.filter(Boolean);
    if (filled.length < 2)
        return -10;
    let s = Math.min(filled.length, 20);
    const blob = filled.join(" ").toLowerCase();
    if (/uniprot|accession|protein\s*ids?|\bipi\b|gene\s*names?/.test(blob))
        s += 6;
    if (/phospho_?location|position|site|residue|amino|modified\s*lysine/.test(blob))
        s += 5;
    if (/ratio|log\s*2|log2|fold\s*change|\bfc\b|significance|p-?value|q-?value/.test(blob))
        s += 6;
    if (/average|stdev|peptides/.test(blob))
        s += 2;
    // prose / legend rows
    if (/table\s*legend|official name of the|unique protein identifier from/i.test(blob))
        s -= 20;
    if (filled.some((c) => c.length > 100))
        s -= 12;
    if (filled.length <= 2 && filled.some((c) => c.length > 40))
        s -= 8;
    // mostly numeric → data row, not header
    const numeric = filled.filter((c) => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(c)).length;
    if (numeric >= filled.length * 0.5)
        s -= 10;
    // Compact column-name headers (Protein: X / Peptide: Y) score higher
    const compact = filled.filter((c) => c.length <= 60 && /:/.test(c)).length;
    if (compact >= 3)
        s += 8;
    return s;
}
function looksLikeLegendCell(text) {
    const t = text.trim();
    if (!t)
        return false;
    // Multi-row Excel group headers for quantitative blocks — keep for merge
    // (e.g. "Lactylation sites quantitation" / "Normalized … quantitation" over P1/P5/P7)
    if (/\b(quantitation|quantity|abundance|intensity|normalized|nomolized|ratio|fold\s*change|log\s*2|log2)\b/i.test(t)) {
        return false;
    }
    if (/\b(modification\s*sites?|site\s*information|sites?\s*information)\b/i.test(t)) {
        return false;
    }
    if (t.length > 60)
        return true;
    if (/^(table\s*)?legend/i.test(t))
        return true;
    if (/\b(official name|unique protein identifier|according to information|calculated based|sequence of peptide|modifications found|quality scores|level of confidence)\b/i.test(t))
        return true;
    // Multi-word prose without short column-name shape (e.g. "Confidence of peptide identification")
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length >= 3 && !/^(protein|peptide|gene|site|mod|sample)[:\s]/i.test(t) && !/\bratio\b/i.test(t)) {
        return true;
    }
    if (t.length > 28 && /\s/.test(t) && !/^(protein|peptide|gene|site|mod):/i.test(t) && !/ratio|log2|fold|p-?value/i.test(t)) {
        return true;
    }
    return false;
}
/** Whether a multi-row group header should be prefixed onto the column name. */
function shouldMergeGroupHeader(group, cur) {
    if (!group || !cur)
        return false;
    if (group.toLowerCase() === cur.toLowerCase())
        return false;
    if (looksLikeLegendCell(group))
        return false;
    // Quantitative blocks over sample channels (P1/P5/P7 under "… quantitation")
    if (/\b(quantitation|quantity|abundance|intensity|normalized|nomolized|ratio|fold\s*change|log\s*2|log2)\b/i.test(group)) {
        return true;
    }
    // Short channel / timepoint labels under a section header
    if (/^(p|d|day)\s*\d{1,2}$/i.test(cur))
        return true;
    if (/^\d+\s*\/\s*\d+$/.test(cur))
        return true;
    if (/^(sample|rep|replicate|bio)\s*[-_]?\s*\d+$/i.test(cur))
        return true;
    // Do NOT glue section titles like "Modification sites information" onto
    // "Protein accession" / "position" / "name" — those are already good column names.
    return false;
}
/** Merge group header (previous row) with column header when useful. */
function buildHeaders(matrix, headerIdx) {
    const row = matrix[headerIdx] ?? [];
    const prev = headerIdx > 0 ? (matrix[headerIdx - 1] ?? []) : [];
    const width = Math.min(Math.max(row.length, prev.length), MAX_HEADER_COLS);
    const headers = [];
    let lastGroup = "";
    for (let i = 0; i < width; i++) {
        const cur = String(row[i] ?? "").trim();
        const pRaw = String(prev[i] ?? "").trim();
        // Never merge legend / prose from the previous row into column names
        const p = looksLikeLegendCell(pRaw) ? "" : pRaw;
        if (p && p.length < 80)
            lastGroup = p;
        // forward-fill sparse group headers (merged cells → empty under the same block)
        const group = p && p.length < 80 ? p : lastGroup;
        if (shouldMergeGroupHeader(group, cur)) {
            headers.push(`${group} ${cur}`.trim());
        }
        else if (cur) {
            headers.push(cur);
        }
        else if (group && !looksLikeLegendCell(group)) {
            headers.push(group);
        }
        else {
            headers.push(`col_${i + 1}`);
        }
    }
    // de-dupe identical headers by suffixing index
    const seen = new Map();
    return headers.map((h) => {
        const n = (seen.get(h) ?? 0) + 1;
        seen.set(h, n);
        return n === 1 ? h : `${h}__${n}`;
    });
}
function detectHeaderIndex(matrix) {
    const limit = Math.min(HEADER_SCAN_ROWS, matrix.length);
    let bestIdx = 0;
    let bestScore = -999;
    for (let i = 0; i < limit; i++) {
        const sc = scoreHeaderRow(matrix[i] ?? []);
        if (sc > bestScore) {
            bestScore = sc;
            bestIdx = i;
        }
    }
    return bestIdx;
}
function asStringMatrix(rows, maxRows) {
    return rows.slice(0, maxRows).map((r) => r.map((c) => String(c ?? "").trim()));
}
function sheetFromMatrix(name, matrix, maxDataRows) {
    if (!matrix.length) {
        return { name, headers: [], preview: [], headerRowIndex: 0, dataRowCount: 0 };
    }
    const headerRowIndex = detectHeaderIndex(matrix);
    const headers = buildHeaders(matrix, headerRowIndex);
    const data = asStringMatrix(matrix.slice(headerRowIndex + 1), maxDataRows).map((r) => headers.map((_, i) => r[i] ?? ""));
    return {
        name,
        headers,
        preview: data.slice(0, PREVIEW_ROWS),
        headerRowIndex,
        dataRowCount: data.length,
    };
}
function readDelimited(path, maxRows) {
    const text = readFileSync(path, "utf8");
    const first = text.split(/\r?\n/, 1)[0] ?? "";
    const tabCount = (first.match(/\t/g) ?? []).length;
    const commaCount = (first.match(/,/g) ?? []).length;
    let matrix;
    if (tabCount > commaCount) {
        matrix = text
            .split(/\r?\n/)
            .filter((l) => l.trim())
            .slice(0, HEADER_SCAN_ROWS + maxRows)
            .map((l) => l.split("\t"));
    }
    else {
        matrix = parseCsv(text).slice(0, HEADER_SCAN_ROWS + maxRows);
    }
    return sheetFromMatrix(basename(path), matrix, maxRows);
}
function isRealExcelSheetName(name) {
    const n = (name || "").trim();
    if (!n)
        return false;
    // Excel defined-name / filter / Power Query junk that SheetJS sometimes surfaces
    if (n.startsWith("_xlnm."))
        return false;
    if (/^microsoft\.com:/i.test(n))
        return false;
    return true;
}
function readExcelSheets(path, opts) {
    const scan = opts.previewOnly ? HEADER_SCAN_ROWS + PREVIEW_ROWS + 2 : opts.maxRows + HEADER_SCAN_ROWS + 2;
    const wb = XLSX.readFile(path, {
        sheetRows: scan,
        cellDates: false,
    });
    const sheets = [];
    const names = wb.SheetNames.filter(isRealExcelSheetName);
    for (const name of names.slice(0, opts.maxSheets)) {
        const sheet = wb.Sheets[name];
        if (!sheet)
            continue;
        const matrix = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: "",
            raw: false,
        });
        sheets.push(sheetFromMatrix(name, matrix, opts.previewOnly ? PREVIEW_ROWS : opts.maxRows));
    }
    return sheets;
}
export function inventoryFile(localPath, entryPath, size) {
    const ext = extname(localPath).toLowerCase();
    try {
        if (ext === ".xlsx" || ext === ".xls") {
            const sheets = readExcelSheets(localPath, {
                previewOnly: true,
                maxSheets: MAX_SHEETS_PER_FILE,
                maxRows: PREVIEW_ROWS,
            });
            return { entryPath, localPath, size, ext, sheets };
        }
        if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
            const sheet = readDelimited(localPath, PREVIEW_ROWS);
            return {
                entryPath,
                localPath,
                size,
                ext,
                sheets: [sheet],
            };
        }
        return {
            entryPath,
            localPath,
            size,
            ext,
            sheets: [],
            error: `unsupported extension ${ext}`,
        };
    }
    catch (err) {
        return {
            entryPath,
            localPath,
            size,
            ext,
            sheets: [],
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
/** Load full sheet rows (header excluded) for parsing. */
export function loadSheetData(localPath, sheetName, maxRows = MAX_PARSE_ROWS, headerRowIndex) {
    const ext = extname(localPath).toLowerCase();
    if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
        const text = readFileSync(localPath, "utf8");
        const first = text.split(/\r?\n/, 1)[0] ?? "";
        const tabCount = (first.match(/\t/g) ?? []).length;
        const commaCount = (first.match(/,/g) ?? []).length;
        const matrix = tabCount > commaCount
            ? text
                .split(/\r?\n/)
                .filter((l) => l.trim())
                .map((l) => l.split("\t"))
            : parseCsv(text);
        if (!matrix.length)
            return { headers: [], rows: [] };
        const hdrIdx = headerRowIndex ?? detectHeaderIndex(matrix);
        const headers = buildHeaders(matrix, hdrIdx);
        const rows = asStringMatrix(matrix.slice(hdrIdx + 1), maxRows).map((r) => headers.map((_, i) => r[i] ?? ""));
        return { headers, rows };
    }
    const wb = XLSX.readFile(localPath, {
        sheetRows: maxRows + HEADER_SCAN_ROWS + 2,
        cellDates: false,
    });
    const name = wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
    const sheet = name ? wb.Sheets[name] : undefined;
    if (!sheet)
        return { headers: [], rows: [] };
    const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
    });
    if (!matrix.length)
        return { headers: [], rows: [] };
    const hdrIdx = headerRowIndex ?? detectHeaderIndex(matrix);
    const headers = buildHeaders(matrix, hdrIdx);
    const rows = asStringMatrix(matrix.slice(hdrIdx + 1), maxRows).map((r) => headers.map((_, i) => r[i] ?? ""));
    return { headers, rows };
}
export function buildPmidInventory(pmid, zipPath, workDir, forceIncludePaths = []) {
    if (existsSync(workDir)) {
        rmSync(workDir, { recursive: true, force: true });
    }
    mkdirSync(workDir, { recursive: true });
    const candidates = pickCandidateEntries(zipPath, MAX_CANDIDATE_FILES, forceIncludePaths);
    if (candidates.length === 0) {
        return {
            pmid,
            zipPath,
            files: [],
            inventoriedAt: new Date().toISOString(),
        };
    }
    extractZipEntries(zipPath, candidates.map((c) => c.path), workDir);
    const files = [];
    for (const c of candidates) {
        const local = resolveExtractedPath(workDir, c.path);
        if (!local) {
            files.push({
                entryPath: c.path,
                localPath: "",
                size: c.size,
                ext: extname(c.path).toLowerCase(),
                sheets: [],
                error: "extract failed",
            });
            continue;
        }
        files.push(inventoryFile(local, c.path, c.size));
    }
    return {
        pmid,
        zipPath,
        files,
        inventoriedAt: new Date().toISOString(),
    };
}
export function writeInventoryJson(path, inv) {
    mkdirSync(dirname(path), { recursive: true });
    // Drop full local absolute paths noise? keep for debugging parse
    writeFileSync(path, JSON.stringify(inv, null, 2) + "\n", "utf8");
}
