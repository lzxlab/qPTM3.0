import { conditionLabelFromRatioHeader, isSilacChannelRatioHeader, resolveRowCondition, silacBiologySuffixFromHeader, } from "./condition.js";
import { mapGenesToUniprot, normalizeGeneSymbol } from "./gene-uniprot.js";
import { alignConditionsToStage3, scoreIntensity, } from "./heuristic.js";
import { resolveRowSample, resolveSheetAsSample } from "./parse-rows.js";
import { resolveSingleModification } from "./ptm.js";
import { loadSheetData, resolveColumnIndex } from "./tables.js";
export const PROTEOME_CSV_HEADER = [
    "PMID",
    "Sample",
    "Sample type",
    "Organism",
    "PTMs",
    "Condition",
    "UniProtID",
    "Log2Ratio",
    "P value",
    "Sheet",
];
function norm(h) {
    return h.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}
function hasAny(headers, pred) {
    return headers.some((h) => pred(norm(h)));
}
/** PTM / modification cues that mean "not whole proteome". */
export function hasPtmCues(sheetName, headers) {
    const name = sheetName.toLowerCase();
    // Sheet titles that are clearly PTM / site tables
    if (/site[_\s-]?quant|modification\s*sites?|lactyl|phospho|phos\b|kla\b|acetylome|ubiquit|glcnac|glysite|glyco|o\s*[- ]?glcnac/.test(name)) {
        return true;
    }
    // Header-level PTM markers (do not use bare "protein description")
    if (hasAny(headers, (n) => /modified\s*sequence|localization\s*prob|lactylation|phosphorylation\s*prob|modification\s*sites?|^amino\s*acids?$|positions?\s+within\s+proteins?|phospho\s*\(sty\)|glygly\s*\(k\)|acetyl\s*\(k\)|kla\b|phosphosite|protein\s*\+\s*phosphosite|gene\s*\+\s*(?:phospho)?site|^feature[_\s-]?names?$/.test(n))) {
        return true;
    }
    // Strong PTM vocabulary in headers (not sheet-name alone — avoid false hits on GO tables)
    if (hasAny(headers, (n) => /\b(lactyl|phospho|phosphosite|ubiquit|succinyl|malonyl|crotonyl|glygly|kac|kla|acetyl|glcnac|o\s*glcnac|glycosyl|glyco)\b/.test(n))) {
        return true;
    }
    return false;
}
export function hasSiteColumns(headers) {
    return hasAny(headers, (n) => /^positions?$/.test(n) ||
        /^sites?$/.test(n) ||
        /^aa$/.test(n) ||
        // Phospho residue-type columns (S/T/Y); often paired with AA=position
        /^sty$/.test(n) ||
        /^s\s*\/\s*t\s*\/\s*y$/.test(n) ||
        /^residue\s*types?$/.test(n) ||
        /positions?\s+within\s+proteins?/.test(n) ||
        /site\s*positions?/.test(n) ||
        /^amino\s*acids?$/.test(n) ||
        /modification\s*sites?/.test(n) ||
        /phosphosite/.test(n) ||
        /protein\s*\+\s*phosphosite/.test(n) ||
        /gene(?:\s*name)?\s*\+\s*(?:phospho)?site/.test(n) ||
        /uniprot.*\+\s*phosphosite|phosphosite.*\+\s*uniprot/.test(n) ||
        /^feature[_\s-]?names?$/.test(n) ||
        // Acetylome / lactylome etc. — align with heuristic scorePosition()
        /modified\s*lysine|modfied\s*lysine|mod(?:ified)?\s*lys/.test(n) ||
        /modified\s*(serine|threonine|tyrosine|residue)/.test(n) ||
        /phospho_?location/.test(n) ||
        // Glycosylation / generic PTM site columns (e.g. "O-GlcNAc site")
        /\b(?:o\s*[- ]?)?glcnac\s*site\b/.test(n) ||
        /\b(?:glyco(?:syl)?|ubiquit|acetyl|methyl|succinyl|malonyl|crotonyl|lactyl|phospho|kla|kac)\w*\s+site\b/.test(n));
}
function hasIdColumn(headers) {
    return hasAny(headers, (n) => /uniprot/.test(n) ||
        /^accession/.test(n) ||
        /protein\s*accession/.test(n) ||
        /^proteins?$/.test(n) ||
        /^protein\s*ids?$/.test(n) ||
        /protein\s*groups?/.test(n) ||
        /^pg\./.test(n) ||
        /^leading\s*proteins?$/.test(n) ||
        /^majority\s*protein\s*ids?$/.test(n) ||
        /^gene\s*names?$/.test(n) ||
        /^gene\s*symbols?$/.test(n) ||
        /^genes?$/.test(n));
}
function scoreProteomeRatio(n) {
    if (scoreIntensity(n) >= 8)
        return 0;
    if (/variability|count|unique|razor|sequence\s*coverage|coverage\s*%|mw\s*\[|peptides$/.test(n))
        return 0;
    if (/^1\s*\/\s*/.test(n))
        return 2;
    if (/site|peptide|mod|phospho|lactyl|kla|kac/.test(n) && /ratio|fc|fold|log/.test(n))
        return 0;
    let s = 0;
    if (/(log\s*2|log2)/.test(n) && /(ratio|fc|fold)/.test(n))
        s = 10;
    else if (/^log\s*2?\s*fc$|^logfc$|^log\.?\s*fc$/.test(n))
        s = 9;
    else if (/\bratio\b/.test(n))
        s = 9;
    else if (/\bfold\s*change\b|\bfc\b/.test(n))
        s = 8;
    else if (/log\s*fc|logfc/.test(n))
        s = 8;
    else if (/(log\s*2|log2)/.test(n))
        s = 6;
    if (/(normalized|nomolized)/.test(n) && s > 0)
        s += 1;
    // Prefer protein-level wording
    if (/protein/.test(n) && s > 0)
        s += 1;
    return s;
}
function scoreProteomeP(n) {
    if (/variability|intensity|count/.test(n))
        return 0;
    if (/site|peptide|mod|phospho|lactyl/.test(n))
        return 0;
    if (/adj\.?\s*p|q[- ]?value|fdr/.test(n))
        return 9;
    if (/p[- ]?value|pval|\bp\b|significance/.test(n))
        return 8;
    return 0;
}
function hasRatioColumns(headers) {
    return headers.some((h) => scoreProteomeRatio(norm(h)) >= 6);
}
function hasOnlyIntensity(headers) {
    const ints = headers.filter((h) => scoreIntensity(norm(h)) >= 8);
    return ints.length > 0 && !hasRatioColumns(headers);
}
function proteomeNameBoost(sheetName) {
    const n = sheetName.toLowerCase();
    if (/proteome|protein\s*quant|total\s*protein|global\s*protein|protein[_\s-]?list/.test(n))
        return 3;
    // Short sheet titles used for whole-proteome tables (e.g. "pro", "prot")
    if (/^pro$|^prot$|^proteins?$/.test(n))
        return 3;
    if (/^avsb$|^avs\b|protein/.test(n) && !/site|pept|mod|phos/.test(n))
        return 1;
    return 0;
}
/**
 * Classify a sheet before parsing.
 * ptm_no_site: has PTM cues but no site columns → NEVER treat as proteome.
 */
export function classifySheetKind(sheetName, headers) {
    const clean = headers.filter(Boolean);
    if (!clean.length)
        return "other";
    const site = hasSiteColumns(clean);
    const ptm = hasPtmCues(sheetName, clean);
    const id = hasIdColumn(clean);
    const ratio = hasRatioColumns(clean);
    const intensityOnly = hasOnlyIntensity(clean);
    if (site && (ptm || ratio || id))
        return "site_ptm";
    // Critical: modification tables missing Position must not become proteome
    if (ptm && !site)
        return "ptm_no_site";
    if (id && ratio && !ptm && !site)
        return "proteome";
    if (id && intensityOnly && !ptm && !site)
        return "intensity";
    if (proteomeNameBoost(sheetName) >= 3 && id && ratio && !site)
        return "proteome";
    return "other";
}
function findBest(headers, scoreFn, min) {
    let best = null;
    let bestS = min - 1;
    for (const h of headers) {
        const s = scoreFn(norm(h));
        if (s > bestS) {
            bestS = s;
            best = h;
        }
    }
    return bestS >= min ? best : null;
}
function scoreUniprot(n) {
    if (/uniprot/.test(n))
        return 10;
    if (/^pg\.?\s*protein\s*groups?$/.test(n) || /^protein\s*groups?$/.test(n))
        return 9;
    if (/protein\s*groups?/.test(n) && !/count|number|razor/.test(n))
        return 8;
    if (/^leading\s*proteins?$/.test(n) || /^majority\s*protein\s*ids?$/.test(n))
        return 8;
    if (/protein\s*accession|^accession/.test(n))
        return 9;
    if (/^proteins?$|^protein\s*ids?$/.test(n))
        return 8;
    if (/accession/.test(n))
        return 6;
    return 0;
}
function scoreGene(n) {
    if (/^gene\s*names?$|^gene\s*symbols?$/.test(n))
        return 10;
    if (/^genes?$/.test(n))
        return 8;
    if (/gene\s*name|gene\s*symbol/.test(n))
        return 7;
    return 0;
}
function isLog2Header(n) {
    return /log\s*2|log2|2\s*log|2log|^log\s*fc$|^logfc$|^log\.?\s*fc$|log\s*fc/.test(n);
}
function conditionFromHeader(h, sheetName) {
    return conditionLabelFromRatioHeader(h, sheetName);
}
function ratioIsLog2Header(n) {
    if (isSilacChannelRatioHeader(n))
        return false;
    return isLog2Header(n);
}
export function heuristicMapProteomeSheet(entryPath, sheet, opts) {
    const kind = classifySheetKind(sheet.name, sheet.headers);
    // Never promote PTM site / site-less-mod sheets to proteome
    if (kind === "site_ptm" || kind === "ptm_no_site")
        return null;
    if (kind !== "proteome" && !opts?.force)
        return null;
    const headers = sheet.headers.filter(Boolean);
    const uniprotCol = findBest(headers, scoreUniprot, 5);
    const geneCol = findBest(headers, scoreGene, 7);
    if (!uniprotCol && !geneCol)
        return null;
    const ratioCandidates = [];
    for (const h of headers) {
        const s = scoreProteomeRatio(norm(h));
        if (s >= 6)
            ratioCandidates.push({ h, score: s });
    }
    ratioCandidates.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const ratioColumns = [];
    for (const r of ratioCandidates) {
        const cond = conditionFromHeader(r.h, sheet.name);
        const silacSuffix = silacBiologySuffixFromHeader(r.h);
        const key = silacSuffix
            ? `silac:${silacSuffix.toLowerCase().replace(/[\s_]+/g, "")}`
            : cond.toLowerCase().replace(/\s+/g, "");
        if (seen.has(key))
            continue;
        seen.add(key);
        const n = norm(r.h);
        ratioColumns.push({
            column: r.h,
            condition: cond,
            isLog2: ratioIsLog2Header(n),
            level: "protein",
            valueType: ratioIsLog2Header(n) ? "log2_ratio" : "fold_change",
        });
        if (ratioColumns.length >= 12)
            break;
    }
    if (ratioColumns.length === 0)
        return null;
    const pValueColumns = [];
    for (const h of headers) {
        if (scoreProteomeP(norm(h)) < 7)
            continue;
        let cond = "";
        for (const r of ratioColumns) {
            const rc = r.condition.toLowerCase().replace(/\s+/g, "");
            if (rc && norm(h).includes(rc.replace("/", ""))) {
                cond = r.condition;
                break;
            }
        }
        pValueColumns.push({ column: h, condition: cond || ratioColumns[0]?.condition || "", level: "protein" });
    }
    let confidence = 0.55;
    if (uniprotCol)
        confidence += 0.2;
    else if (geneCol)
        confidence += 0.1;
    confidence += Math.min(ratioColumns.length, 4) * 0.05;
    confidence += proteomeNameBoost(sheet.name) * 0.05;
    if (opts?.force)
        confidence = Math.max(confidence, 0.7);
    confidence = Math.min(confidence, 0.95);
    return {
        entryPath,
        sheetName: sheet.name,
        headerRowIndex: sheet.headerRowIndex ?? 0,
        confidence,
        uniprotCol,
        geneCol: uniprotCol ? null : geneCol,
        ratioColumns,
        pValueColumns: pValueColumns.slice(0, 24),
        notes: `proteome; ratios=${ratioColumns.length}${opts?.force ? "; forced" : ""}`,
    };
}
function colIndex(headers, name) {
    return resolveColumnIndex(headers, name);
}
function firstUniprot(raw) {
    const parts = raw.split(/[;,\s|/]+/).map((x) => x.trim()).filter(Boolean);
    for (const p of parts) {
        const m = p.match(/(?:sp|tr)\|([A-Z0-9]+)/i) ||
            p.match(/\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})\b/);
        if (m)
            return (m[1] ?? m[0]).toUpperCase();
        if (/^[A-Z0-9]{5,12}(?:-\d+)?$/i.test(p))
            return p.toUpperCase();
    }
    return parts[0]?.toUpperCase() ?? "";
}
function parseNumber(raw) {
    const t = raw.replace(/,/g, "").trim();
    if (!t || t === "NA" || t === "NaN" || t === "#N/A" || t === "null")
        return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}
function toLog2(value, isLog2) {
    if (isLog2)
        return value;
    if (value <= 0)
        return null;
    return Math.log2(value);
}
function fmtNum(n) {
    if (n == null || !Number.isFinite(n))
        return "";
    return Number(n).toFixed(2);
}
export async function parseProteomeSheet(opts) {
    const { headers, rows } = loadSheetData(opts.localPath, opts.mapping.sheetName, opts.maxRows, opts.mapping.headerRowIndex);
    if (!headers.length)
        return [];
    // Safety re-check: refuse if this sheet looks like PTM-without-site
    const kind = classifySheetKind(opts.mapping.sheetName, headers);
    if (kind === "site_ptm" || kind === "ptm_no_site")
        return [];
    if (kind !== "proteome" && !opts.forceProteome)
        return [];
    const m = opts.mapping;
    const sheetSample = resolveSheetAsSample(m.sheetName, opts.lit.sample, Boolean(opts.preferSheetAsSample));
    const singlePtm = resolveSingleModification({
        litPtms: opts.lit.ptms,
        sheetName: m.sheetName,
        headers,
        enrichmentMethod: opts.lit.enrichmentMethod,
    });
    const uIdx = colIndex(headers, m.uniprotCol);
    const gIdx = colIndex(headers, m.geneCol);
    if (uIdx < 0 && gIdx < 0)
        return [];
    let geneMap;
    if (uIdx < 0 && gIdx >= 0) {
        const genes = [];
        for (const row of rows) {
            const g = normalizeGeneSymbol(row[gIdx] ?? "");
            if (g)
                genes.push(g);
        }
        geneMap = await mapGenesToUniprot(genes, opts.lit.organism);
    }
    const out = [];
    const sheetRef = `${m.entryPath}#${m.sheetName}`;
    for (const row of rows) {
        let uid = "";
        if (uIdx >= 0)
            uid = firstUniprot(row[uIdx] ?? "");
        else if (gIdx >= 0 && geneMap) {
            const g = normalizeGeneSymbol(row[gIdx] ?? "");
            uid = (g && (geneMap.get(g) || geneMap.get(g.toLowerCase()))) || "";
            if (!uid && g) {
                for (const [k, v] of geneMap) {
                    if (k.toLowerCase() === g.toLowerCase()) {
                        uid = v;
                        break;
                    }
                }
            }
        }
        if (!uid)
            continue;
        for (const ratio of m.ratioColumns) {
            const rIdx = colIndex(headers, ratio.column);
            if (rIdx < 0)
                continue;
            const rawN = parseNumber(row[rIdx] ?? "");
            if (rawN == null)
                continue;
            const log2 = toLog2(rawN, Boolean(ratio.isLog2) || ratio.valueType === "log2_ratio");
            if (log2 == null)
                continue;
            let pVal = "";
            for (const p of m.pValueColumns) {
                if (p.condition &&
                    p.condition.toLowerCase().replace(/\s+/g, "") !==
                        ratio.condition.toLowerCase().replace(/\s+/g, "")) {
                    continue;
                }
                const pIdx = colIndex(headers, p.column);
                if (pIdx < 0)
                    continue;
                const pn = parseNumber(row[pIdx] ?? "");
                if (pn != null) {
                    pVal = fmtNum(pn);
                    break;
                }
            }
            const condition = resolveRowCondition(ratio.condition?.trim() || "", opts.lit.condition || opts.fallbackCondition || "", opts.lit.detailCondition || "");
            out.push({
                pmid: opts.lit.pmid,
                sample: resolveRowSample(opts.lit.sample, {
                    tableSample: sheetSample,
                    condition,
                    conditionSampleMap: opts.lit.conditionSampleMap,
                }),
                sampleType: opts.lit.sampleType,
                organism: opts.lit.organism,
                ptms: singlePtm,
                condition,
                uniprotId: uid,
                log2Ratio: fmtNum(log2),
                pValue: pVal,
                sheetRef,
            });
        }
    }
    return out;
}
/** Align proteome ratio conditions to Stage3 (reuse site aligner shape). */
export function alignProteomeConditions(mapping, stage3Condition, detailCondition = "") {
    const fake = alignConditionsToStage3({
        entryPath: mapping.entryPath,
        sheetName: mapping.sheetName,
        headerRowIndex: mapping.headerRowIndex,
        confidence: mapping.confidence,
        source: "heuristic",
        uniprotCol: mapping.uniprotCol,
        geneCol: mapping.geneCol,
        positionCol: null,
        aminoAcidCol: null,
        siteCombinedCol: null,
        modSeqCol: null,
        ratioColumns: mapping.ratioColumns,
        pValueColumns: mapping.pValueColumns,
        notes: mapping.notes,
    }, stage3Condition, detailCondition);
    return {
        ...mapping,
        ratioColumns: fake.ratioColumns,
        pValueColumns: fake.pValueColumns,
    };
}
export function proteomeToCsvLine(r) {
    const cells = [
        r.pmid,
        r.sample,
        r.sampleType,
        r.organism,
        r.ptms,
        r.condition,
        r.uniprotId,
        r.log2Ratio,
        r.pValue,
        r.sheetRef,
    ];
    return cells.map(csvEscape).join(",");
}
/**
 * Fill Log2Ratio (protein) / P value (protein) on site-level qratio rows
 * by UniProt (+ Condition when possible).
 * Proteins present only in the proteome table (no site/mod rows) are ignored.
 */
export function enrichSiteRowsWithProteome(siteRows, proteomeRows) {
    if (siteRows.length === 0 || proteomeRows.length === 0) {
        return { filled: 0, matchedProteins: 0 };
    }
    const byUid = new Map();
    for (const p of proteomeRows) {
        const uid = (p.uniprotId || "").toUpperCase();
        if (!uid || !p.log2Ratio)
            continue;
        const ck = (p.condition || "").toLowerCase().replace(/\s+/g, "");
        let m = byUid.get(uid);
        if (!m) {
            m = new Map();
            byUid.set(uid, m);
        }
        // Prefer first non-empty; later same key overwrites
        m.set(ck, { log2: p.log2Ratio, p: p.pValue || "" });
    }
    const matchedUids = new Set();
    let filled = 0;
    for (const r of siteRows) {
        const uid = (r.uniprotId || "").toUpperCase();
        const cmap = byUid.get(uid);
        if (!cmap || cmap.size === 0)
            continue;
        const ck = (r.condition || "").toLowerCase().replace(/\s+/g, "");
        let hit = ck ? cmap.get(ck) : undefined;
        if (!hit && cmap.size === 1) {
            hit = [...cmap.values()][0];
        }
        if (!hit && ck) {
            for (const [k, v] of cmap) {
                if (!k)
                    continue;
                if (k.includes(ck) || ck.includes(k)) {
                    hit = v;
                    break;
                }
            }
        }
        // Last resort: empty-condition proteome entry
        if (!hit)
            hit = cmap.get("");
        // Condition labels often diverge (Stage3-aligned site vs table-header proteome).
        // Still fill Log2Ratio (protein) from any UniProt match when keys disagree.
        if (!hit && cmap.size > 0) {
            hit = [...cmap.values()][0];
        }
        if (!hit)
            continue;
        r.log2RatioProtein = hit.log2;
        if (hit.p)
            r.pValueProtein = hit.p;
        filled++;
        matchedUids.add(uid);
    }
    return { filled, matchedProteins: matchedUids.size };
}
function csvEscape(v) {
    if (/[",\n\r]/.test(v))
        return `"${v.replace(/"/g, '""')}"`;
    return v;
}
