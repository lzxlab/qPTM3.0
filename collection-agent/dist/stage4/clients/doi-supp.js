/**
 * Discover + download publisher supplementary files via DOI landing page.
 * Used when Europe PMC OA ZIP is unavailable (non-OA / no PMCID).
 *
 * Strategy:
 * 1) Resolve doi.org → publisher HTML
 * 2) Parse tabular / ESM links (Nature/Springer static-content, generic xlsx/csv/zip)
 * 3) Heuristic Nature/Springer MOESM URL guesses
 * 4) Download files and pack into a ZIP for Stage5
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fetchBinary, fetchText, HttpError } from "../../stage2/http.js";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const TABULAR_RE = /\.(xlsx|xls|csv|tsv|zip)(?:\?|$)/i;
const SUPP_NAME_RE = /\b(supplement|supporting|esm|moesm|dataset|table\s*s?\d*|additional\s*file)\b/i;
function normalizeDoi(doi) {
    return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "");
}
function absUrl(href, base) {
    try {
        return new URL(href, base).toString();
    }
    catch {
        return null;
    }
}
function filenameFromUrl(url) {
    try {
        const u = new URL(url);
        const base = basename(u.pathname);
        return decodeURIComponent(base || "supplementary.bin");
    }
    catch {
        return "supplementary.bin";
    }
}
function isLikelySuppUrl(url, textNear = "") {
    const u = url.toLowerCase();
    if (/static-content\.springer\.com\/esm\b/.test(u))
        return true;
    if (/\/mediaobjects\//i.test(u) && /moesm|esm/i.test(u))
        return true;
    if (TABULAR_RE.test(u) && SUPP_NAME_RE.test(`${u} ${textNear}`))
        return true;
    if (TABULAR_RE.test(u) && /supplement|supporting|esm|dataset/i.test(u))
        return true;
    // Nature often links xlsx without the word in path but under supplementary section
    if (TABULAR_RE.test(u))
        return true;
    return false;
}
/** Prefer tabular files; keep zip; drop peer-review / reporting-summary noise when possible. */
function rankFile(ref) {
    const n = `${ref.filename} ${ref.url}`.toLowerCase();
    let s = 0;
    if (/\.xlsx?$/i.test(n))
        s += 5;
    if (/\.(csv|tsv)$/i.test(n))
        s += 4;
    if (/\.zip$/i.test(n))
        s += 3;
    if (/moesm|supplementary\s*data|dataset|table/i.test(n))
        s += 2;
    if (/peer[- ]?review|reporting\s*summary|checklist/i.test(n))
        s -= 4;
    if (/\.pdf$/i.test(n))
        s -= 1;
    return s;
}
export function parseSupplementaryLinks(html, baseUrl) {
    const out = new Map();
    const add = (href, source, near = "") => {
        const url = absUrl(href.replace(/&amp;/g, "&"), baseUrl);
        if (!url)
            return;
        if (!isLikelySuppUrl(url, near))
            return;
        // Skip main article PDF / figures
        if (/\/articles\/[^/]+\.pdf$/i.test(url) && !/moesm|supplement|s\d+\.pdf/i.test(url))
            return;
        if (/\/figures?\//i.test(url))
            return;
        const filename = filenameFromUrl(url);
        if (!out.has(url))
            out.set(url, { url, filename, source });
    };
    // href="..."
    const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = hrefRe.exec(html))) {
        const href = m[1];
        const near = html.slice(Math.max(0, m.index - 120), m.index + href.length + 120);
        add(href, "html", near);
    }
    // Absolute static-content URLs embedded in JS/JSON
    const staticRe = /https?:\/\/static-content\.springer\.com\/esm\/[^"'\\\s]+/gi;
    while ((m = staticRe.exec(html))) {
        add(m[0].replace(/\\u002F/g, "/").replace(/\\+/g, ""), "html");
    }
    return [...out.values()];
}
/**
 * Guess Nature/Springer MOESM URLs from DOI like 10.1038/s41592-022-01523-1.
 * Filenames commonly look like 41592_2022_1523_MOESM1_ESM.xlsx
 */
export function guessNatureSpringerEsmUrls(doi) {
    const d = normalizeDoi(doi);
    const out = [];
    // Nature style: 10.1038/s41592-022-01523-1  or 10.1038/nature12345
    const nat = d.match(/^10\.1038\/s(\d+)-(\d{2,4})-(\d+)(?:-[a-z0-9]+)?$/i);
    const natOld = d.match(/^10\.1038\/nature(\d+)$/i);
    let journal = "";
    let year = "";
    let artVariants = [];
    if (nat) {
        journal = nat[1];
        const yy = nat[2];
        year = yy.length === 2 ? `20${yy}` : yy.length === 3 ? `2${yy}` : yy;
        const artRaw = nat[3];
        artVariants = [String(Number(artRaw)), artRaw, artRaw.replace(/^0+/, "") || "0"];
    }
    else if (natOld) {
        // legacy natureNNNNN — less predictable; skip structured guess
        return out;
    }
    else {
        // Springer 10.1007/sxxxxx-xxx-xxxxx-x — leave to HTML parsing
        return out;
    }
    const base = `https://static-content.springer.com/esm/art%3A${encodeURIComponent(d)}/MediaObjects`;
    const exts = ["xlsx", "xls", "zip", "csv", "pdf"];
    const seen = new Set();
    for (let i = 1; i <= 12; i++) {
        for (const artId of [...new Set(artVariants)]) {
            for (const ext of exts) {
                const filename = `${journal}_${year}_${artId}_MOESM${i}_ESM.${ext}`;
                const url = `${base}/${filename}`;
                if (seen.has(url))
                    continue;
                seen.add(url);
                out.push({ url, filename, source: "guess" });
            }
        }
    }
    return out;
}
async function resolveLandingUrl(doi) {
    const d = normalizeDoi(doi);
    const url = `https://doi.org/${d}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
        const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: ctrl.signal,
            headers: {
                "User-Agent": BROWSER_UA,
                Accept: "text/html,application/xhtml+xml,*/*",
            },
        });
        return res.url || url;
    }
    finally {
        clearTimeout(t);
    }
}
async function downloadOne(ref, timeoutMs) {
    try {
        const { buffer, contentType } = await fetchBinary(ref.url, {
            timeoutMs,
            accept: "*/*",
            headers: {
                "User-Agent": BROWSER_UA,
                ...(ref.url.includes("springer.com") || ref.url.includes("nature.com")
                    ? { Referer: "https://www.nature.com/" }
                    : {}),
            },
        });
        if (!buffer || buffer.length < 64)
            return { ok: false, reason: "reject" };
        // HTML error pages
        const head = buffer.subarray(0, Math.min(200, buffer.length)).toString("utf8");
        if (/<!DOCTYPE html|<html/i.test(head) && !TABULAR_RE.test(ref.filename)) {
            return { ok: false, reason: "reject" };
        }
        if (/not found|access denied|captcha/i.test(head) && buffer.length < 5000) {
            return { ok: false, reason: "reject" };
        }
        const ct = (contentType || "").toLowerCase();
        if (ct.includes("text/html"))
            return { ok: false, reason: "reject" };
        return { ok: true, filename: ref.filename, buffer, url: ref.url };
    }
    catch (err) {
        if (err instanceof HttpError && (err.status === 404 || err.status === 403)) {
            return { ok: false, reason: "http" };
        }
        return { ok: false, reason: "network" };
    }
}
/**
 * Download the ranked candidate list with a small parallel window.
 * Early-break heuristics (network blocked, enough files, got a ZIP, too many
 * sequential misses) still apply — results are processed in rank order.
 */
async function downloadCandidates(tryList, files, seenName, notes) {
    const windowSize = 4;
    let consecutiveMiss = 0;
    let consecutiveNetwork = 0;
    let i = 0;
    while (i < tryList.length && files.length < 12) {
        const window = tryList.slice(i, i + windowSize);
        const outcomes = await Promise.all(window.map((ref) => {
            const timeoutMs = ref.source === "guess" ? 15_000 : 60_000;
            return downloadOne(ref, timeoutMs);
        }));
        for (let k = 0; k < window.length; k++) {
            const ref = window[k];
            const got = outcomes[k];
            if (files.length >= 12)
                break;
            if (!got.ok) {
                consecutiveMiss++;
                if (got.reason === "network")
                    consecutiveNetwork++;
                else
                    consecutiveNetwork = 0;
                // CDN unreachable → stop early instead of probing dozens of URLs
                if (consecutiveNetwork >= 3 && files.length === 0) {
                    notes.push("network-blocked");
                    return;
                }
                if (ref.source === "guess" && files.length > 0 && consecutiveMiss >= 6)
                    return;
                continue;
            }
            consecutiveMiss = 0;
            consecutiveNetwork = 0;
            let name = got.filename;
            if (seenName.has(name))
                name = `${ref.source}_${files.length + 1}_${name}`;
            seenName.add(name);
            files.push({ filename: name, buffer: got.buffer, url: got.url });
            if (/\.zip$/i.test(name) && got.buffer.subarray(0, 2).toString("ascii") === "PK") {
                notes.push("got-zip");
                return;
            }
        }
        i += windowSize;
    }
}
/**
 * Discover + download publisher supplementary tabular files for a DOI.
 */
export async function fetchDoiSupplementaryFiles(doi) {
    const d = normalizeDoi(doi);
    if (!d)
        return { status: "error", files: [], landingUrl: null, notes: "empty doi", error: "empty doi" };
    let landingUrl = null;
    const notes = [];
    const candidates = [];
    try {
        landingUrl = await resolveLandingUrl(d);
        notes.push(`landing=${landingUrl}`);
        try {
            const html = await fetchText(landingUrl, {
                timeoutMs: 35_000,
                accept: "text/html,application/xhtml+xml,*/*",
                headers: { "User-Agent": BROWSER_UA },
            });
            const fromHtml = parseSupplementaryLinks(html, landingUrl);
            candidates.push(...fromHtml);
            notes.push(`htmlLinks=${fromHtml.length}`);
        }
        catch (err) {
            notes.push(`html-fetch-fail:${err instanceof Error ? err.message : String(err)}`);
        }
    }
    catch (err) {
        notes.push(`doi-resolve-fail:${err instanceof Error ? err.message : String(err)}`);
    }
    // Always add Nature/Springer guesses (cheap 404s ignored); prefer xlsx/zip first
    if (/^10\.1038\//i.test(d) || /^10\.1007\//i.test(d)) {
        const guesses = guessNatureSpringerEsmUrls(d);
        // Prioritize tabular extensions to cut request volume
        const preferred = guesses.filter((g) => /\.(xlsx|xls|zip|csv)$/i.test(g.filename));
        candidates.push(...preferred);
        notes.push(`guesses=${preferred.length}`);
    }
    // Dedup by URL
    const byUrl = new Map();
    for (const c of candidates) {
        if (!byUrl.has(c.url))
            byUrl.set(c.url, c);
    }
    const ranked = [...byUrl.values()].sort((a, b) => {
        const rb = rankFile(b) - rankFile(a);
        if (rb !== 0)
            return rb;
        // Prefer lower MOESM index
        const nb = Number(b.filename.match(/MOESM(\d+)/i)?.[1] ?? 99);
        const na = Number(a.filename.match(/MOESM(\d+)/i)?.[1] ?? 99);
        return na - nb;
    });
    // Prefer tabular; try top N (cap guesses). Guesses use short timeouts so blocked CDNs fail fast.
    const tryList = ranked.filter((r) => rankFile(r) >= 2).slice(0, 24);
    const files = [];
    const seenName = new Set();
    await downloadCandidates(tryList, files, seenName, notes);
    if (files.length === 0) {
        return {
            status: "not_found",
            files: [],
            landingUrl,
            notes: notes.join(";"),
            error: "no downloadable supplementary files found via DOI",
        };
    }
    return { status: "ok", files, landingUrl, notes: notes.join(";") };
}
/** Pack downloaded files into a ZIP (system `zip`). If a single ZIP already, return it. */
export function packSupplementaryZip(outZipPath, files) {
    if (files.length === 1 && /\.zip$/i.test(files[0].filename) && files[0].buffer.subarray(0, 2).toString("ascii") === "PK") {
        mkdirSync(dirname(outZipPath), { recursive: true });
        writeFileSync(outZipPath, files[0].buffer);
        return;
    }
    const dir = mkdtempSync(join(tmpdir(), "qptm-doi-supp-"));
    try {
        const paths = [];
        for (const f of files) {
            const p = join(dir, f.filename.replace(/[\\/]/g, "_"));
            writeFileSync(p, f.buffer);
            paths.push(p);
        }
        if (existsSync(outZipPath)) {
            try {
                rmSync(outZipPath);
            }
            catch {
                // ignore
            }
        }
        mkdirSync(dirname(outZipPath), { recursive: true });
        execFileSync("zip", ["-j", "-q", outZipPath, ...paths], {
            maxBuffer: 20 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
    finally {
        try {
            rmSync(dir, { recursive: true, force: true });
        }
        catch {
            // ignore
        }
    }
}
