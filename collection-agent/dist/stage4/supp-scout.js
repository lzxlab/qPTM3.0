/**
 * Stage 4 Supplementary scout — score whether OA supp likely holds site-level PTM ratios.
 * Applies to ALL Stage 3 papers (with or without MS repository Identifier).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, stage2FulltextDir } from "../utils/io.js";
import { listZipEntries, readZipEntry } from "./zip.js";
const STRONG_Q = /\b(log2(?:fc|ratio)?|log2\s*(?:fold|ratio)|fold[\s-]?change|ratio|p[\s-]?value|adj\.?\s*p|q[\s-]?value|localization\s*probability|phosphosite|phosphopeptide|acetylsite|ubiquit(?:yl|in)at|di.?gly|k-ε-gg|site[\s-]?level|intensity\s*ratio)\b/i;
const NAME_Q = /\b(table\s*s?\d*|dataset\s*s?\d*|supplement|phospho|acetyl|ubiquit|glyco|ptm|site|ratio|quant)\b/i;
const TABULAR_EXT = /\.(xlsx|xls|csv|tsv|txt|zip)$/i;
const EXCEL_EXT = /\.(xlsx|xls)$/i;
const CSV_EXT = /\.(csv|tsv|txt)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|tif{1,2}|svg)$/i;
const PDF_EXT = /\.pdf$/i;
const DOC_EXT = /\.(docx?|pptx?)$/i;
function stripTags(xml) {
    return xml
        .replace(/<[^>]+>/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}
function scoreText(text) {
    const clues = [];
    let score = 0;
    const lower = text.toLowerCase();
    const add = (re, pts, label) => {
        if (re.test(text) || re.test(lower)) {
            score += pts;
            clues.push(label);
        }
    };
    add(/\blog2/i, 3, "log2");
    add(/\bratio\b/i, 2, "ratio");
    add(/fold[\s-]?change/i, 2, "fold-change");
    add(/p[\s-]?value|adj\.?\s*p|q[\s-]?value/i, 2, "pvalue");
    add(/phosphosite|phosphopeptide|phosphoproteom/i, 3, "phospho");
    add(/acetyl|ubiquit|sumo|glyco|lactyl|methyl/i, 2, "ptm-type");
    add(/di.?gly|k-ε-gg|k-gg/i, 3, "digly");
    add(/localization\s*probability/i, 3, "loc-prob");
    add(/site[\s-]?level|modification\s*site/i, 2, "site");
    add(/tmt|silac|itraq|label[\s-]?free|lfq/i, 1, "quant-method");
    add(/table\s*s\d+/i, 1, "table-s");
    return { score, clues: [...new Set(clues)] };
}
function classifyKind(path) {
    if (EXCEL_EXT.test(path))
        return "excel";
    if (/\.tsv$/i.test(path))
        return "tsv";
    if (/\.csv$/i.test(path) || /\.txt$/i.test(path))
        return "csv";
    if (PDF_EXT.test(path))
        return "pdf";
    if (DOC_EXT.test(path))
        return "doc";
    if (IMAGE_EXT.test(path))
        return "image";
    return "other";
}
export function scanLocalXmlSupp(pmid) {
    const xmlPath = join(stage2FulltextDir(), pmid, "fulltext.xml");
    if (!existsSync(xmlPath))
        return { hits: [], textClues: [], maxScore: 0 };
    const xml = readFileSync(xmlPath, "utf8");
    const hits = [];
    const re = /<(?:inline-)?supplementary-material\b([^>]*)>([\s\S]*?)<\/(?:inline-)?supplementary-material>/gi;
    let m;
    while ((m = re.exec(xml))) {
        const attrs = m[1];
        const body = m[2];
        const href = attrs.match(/xlink:href=["']([^"']+)["']/i)?.[1] ??
            body.match(/xlink:href=["']([^"']+)["']/i)?.[1] ??
            "";
        const caption = stripTags(body).slice(0, 500);
        const blob = `${href} ${caption}`;
        const { score: textScore, clues } = scoreText(blob);
        let score = textScore;
        if (TABULAR_EXT.test(href)) {
            score += 2;
            clues.push("tabular-ext");
        }
        if (NAME_Q.test(href) || NAME_Q.test(caption)) {
            score += 1;
            clues.push("name-hint");
        }
        hits.push({
            href,
            caption,
            score,
            clues: [...new Set(clues)],
        });
    }
    // Also scan table titles / data availability for quantitative cues
    const textClues = [];
    const titles = [...xml.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((x) => stripTags(x[1]));
    for (const t of titles) {
        if (/supplement|table\s*s\d+|dataset/i.test(t) && STRONG_Q.test(t)) {
            const { clues } = scoreText(t);
            textClues.push(`title:${t.slice(0, 80)}(${clues.join(",")})`);
        }
    }
    const avail = xml.match(/data\s+availability[\s\S]{0,2500}/i);
    if (avail) {
        const { score, clues } = scoreText(stripTags(avail[0]));
        if (score >= 2)
            textClues.push(`data-avail:${clues.join(",")}`);
    }
    const maxScore = Math.max(0, ...hits.map((h) => h.score), textClues.length ? 2 : 0);
    return { hits, textClues, maxScore };
}
function peekDelimitedHeader(buf) {
    const text = buf.toString("utf8");
    const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
    return first.slice(0, 500);
}
export function scoreZipEntries(zipPath, entries) {
    const hits = [];
    for (const e of entries) {
        const kind = classifyKind(e.path);
        if (kind === "image")
            continue; // ignore inline-ish images
        const { score: nameScore, clues } = scoreText(e.path);
        let score = nameScore;
        let headerPreview;
        if (kind === "excel") {
            score += 2;
            clues.push("excel");
        }
        else if (kind === "csv" || kind === "tsv") {
            score += 2;
            clues.push(kind);
            const buf = readZipEntry(zipPath, e.path, 64_000);
            if (buf) {
                headerPreview = peekDelimitedHeader(buf);
                const hs = scoreText(headerPreview);
                score += hs.score;
                clues.push(...hs.clues.map((c) => `hdr:${c}`));
                // also try parseCsv on first line for column names
                try {
                    const rows = parseCsv(headerPreview + "\n");
                    if (rows[0]?.length) {
                        const joined = rows[0].join(" ");
                        const cs = scoreText(joined);
                        score += cs.score;
                        clues.push(...cs.clues.map((c) => `col:${c}`));
                    }
                }
                catch {
                    // ignore
                }
            }
        }
        else if (kind === "pdf" || kind === "doc") {
            score += 0;
        }
        if (TABULAR_EXT.test(e.path) || kind === "excel" || kind === "csv" || kind === "tsv" || score > 0) {
            hits.push({
                path: e.path,
                size: e.size,
                kind,
                score,
                clues: [...new Set(clues)],
                headerPreview,
            });
        }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
}
export function decideVerdict(input) {
    const { hasPmcid, zipStatus, xml, zipHits, viaDoi } = input;
    const topZip = zipHits[0];
    const topXml = [...xml.hits].sort((a, b) => b.score - a.score)[0];
    const maxZip = topZip?.score ?? 0;
    const maxXml = Math.max(xml.maxScore, topXml?.score ?? 0);
    const maxScore = Math.max(maxZip, maxXml);
    const hasTabular = zipHits.some((h) => h.kind === "excel" || h.kind === "csv" || h.kind === "tsv");
    const xmlTabular = xml.hits.some((h) => TABULAR_EXT.test(h.href));
    const via = viaDoi ? "doi-publisher" : hasPmcid ? "europepmc" : "local";
    if (!hasPmcid &&
        !viaDoi &&
        zipStatus === "none" &&
        xml.hits.length === 0 &&
        xml.textClues.length === 0) {
        return { verdict: "unavailable", notes: "no PMCID/DOI supp and no local XML supp signals" };
    }
    if (zipStatus === "error") {
        if (maxXml >= 4 || xmlTabular) {
            // still usable from XML hints
        }
        else if (!hasTabular && xml.hits.length === 0) {
            return { verdict: "unavailable", notes: "supplementary zip fetch error" };
        }
    }
    if (maxScore >= 5 || (maxZip >= 4 && hasTabular) || (maxXml >= 4 && xmlTabular)) {
        return {
            verdict: "likely_qptm_table",
            notes: `via=${via}; maxScore=${maxScore}; zipTop=${topZip?.path ?? "-"}; xmlTop=${topXml?.href || topXml?.caption.slice(0, 40) || "-"}`,
        };
    }
    if (hasTabular || xmlTabular) {
        return {
            verdict: "has_tabular_supp",
            notes: `via=${via}; tabular present; maxScore=${maxScore}`,
        };
    }
    if (zipHits.length > 0 || xml.hits.length > 0 || zipStatus === "ok" || zipStatus === "skipped") {
        return {
            verdict: "has_supp_other",
            notes: `via=${via}; non-tabular or weak clues; zipEntries=${zipHits.length}; xmlHits=${xml.hits.length}`,
        };
    }
    if (zipStatus === "not_found" || zipStatus === "empty" || zipStatus === "none") {
        return { verdict: "no_supp", notes: `via=${via}; zipStatus=${zipStatus}` };
    }
    return { verdict: "unavailable", notes: `via=${via}; zipStatus=${zipStatus}` };
}
export function listAndScoreZip(zipPath) {
    if (!existsSync(zipPath))
        return [];
    return scoreZipEntries(zipPath, listZipEntries(zipPath));
}
