/**
 * Stage 5 — heuristic column mapping for qratio fields.
 */
import { canonicalizeConditionKey, cleanMappedCondition, conditionLabelFromRatioHeader, isAnnotationMasqueradingAsCondition, isSilacChannelRatioHeader, resolveRowCondition, silacBiologySuffixFromHeader, } from "./condition.js";
import { resolveColumnName } from "./tables.js";
import { looksLikePhosphositeCombinedId } from "./phosphosite-id.js";
function norm(h) {
    return h.toLowerCase().replace(/\s+/g, " ").trim();
}
function findBest(headers, scorers, minScore = 4) {
    let best = null;
    let bestScore = 0;
    for (const h of headers) {
        const n = norm(h);
        let s = 0;
        for (const fn of scorers)
            s = Math.max(s, fn(n));
        if (s > bestScore) {
            bestScore = s;
            best = h;
        }
    }
    return bestScore >= minScore ? best : null;
}
function scoreUniprot(n) {
    if (/phosphosite|protein\s*\+\s*phospho|gene\s*name\s*\+\s*phospho/i.test(n))
        return 0;
    if (/^uniprotkb$/i.test(n))
        return 11;
    if (/^uniprot(\s*id)?$/.test(n) || n === "uniprotid")
        return 10;
    if (/uniprot/.test(n) && !/name|gene/.test(n))
        return 9;
    // Spectronaut / MaxQuant protein-group accession columns
    if (/^pg\.?\s*protein\s*groups?$/.test(n) || /^protein\s*groups?$/.test(n))
        return 9;
    if (/protein\s*groups?/.test(n) && !/count|number|razor/.test(n))
        return 8;
    if (/^leading\s*proteins?$/.test(n) || /^majority\s*protein\s*ids?$/.test(n))
        return 8;
    if (/ipi\s*accession|accession\s*number/.test(n))
        return 9;
    if (/^accession$/.test(n) || /protein\s*accession/.test(n))
        return 8;
    if (/^protein\s*ids?$/.test(n) || /^proteinid$/.test(n))
        return 6;
    // MaxQuant-style "Proteins" / "protein" column holding accessions
    if (/^proteins?$/.test(n))
        return 8;
    if (/^protein\s*group\s*ids?$/.test(n))
        return 5;
    if (/accession/.test(n))
        return 5;
    return 0;
}
function scorePosition(n) {
    // Strong: residue modification site number columns
    if (/modified\s*lysine|modfied\s*lysine|mod(?:ified)?\s*lys/.test(n))
        return 12;
    if (/modified\s*(serine|threonine|tyrosine|residue)/.test(n))
        return 12;
    if (/phospho_?location/.test(n))
        return 10;
    if (/\b(?:o\s*[- ]?)?glcnac\s*site\b/.test(n))
        return 12;
    if (/\b(?:glyco(?:syl)?|ubiquit|acetyl|methyl|succinyl|malonyl|crotonyl|lactyl|phospho|kla|kac)\w*\s+site\b/.test(n)) {
        return 10;
    }
    if (/site\s*positions?/.test(n))
        return 10;
    if (/positions?\s+within\s+proteins?/.test(n))
        return 10;
    if (/^sites?$/.test(n))
        return 9;
    if (/^positions?$/.test(n) || /^pos$/.test(n))
        return 9;
    if (/residue\s*positions?/.test(n))
        return 9;
    if (/modification\s*positions?/.test(n))
        return 8;
    // Peptide span in protein (P32783 [357-382]) — NOT the modification site
    if (/positions?\s+in\s+(a\s+)?master\s*proteins?/.test(n))
        return 0;
    if (/positions?\s+in\s+proteins?/.test(n) && /master|peptide/.test(n))
        return 0;
    // Protein-level position preferred over "position in peptide"
    if (/\bpositions?\b/.test(n) && /peptide/.test(n))
        return 4;
    if (/\bpositions?\b/.test(n) && !/gene|chrom|master|accession/.test(n))
        return 7;
    if (/\bsite\b/.test(n) && /pos/.test(n))
        return 7;
    return 0;
}
function scoreAmino(n) {
    // Phospho residue-type headers (values are S/T/Y)
    if (/^sty$/.test(n) || /^s\s*\/\s*t\s*\/\s*y$/.test(n))
        return 11;
    if (/^residue\s*types?$/.test(n))
        return 10;
    if (/amino\s*acids?/.test(n))
        return 10;
    // Bare "AA" is ambiguous: often position when paired with STY (handled in repair)
    if (/^aa$/.test(n) || /^residue$/.test(n))
        return 9;
    if (/modified\s*residue/.test(n))
        return 8;
    if (/\bresidue\b/.test(n) && !/position/.test(n))
        return 6;
    return 0;
}
/** MaxQuant-style probability / modified-sequence columns (AA can be inferred). */
function scoreModSequence(n) {
    if (/lactylation\s*probabilities/.test(n))
        return 10;
    if (/phosphorylation\s*probabilities|modification\s*probabilities/.test(n))
        return 9;
    if (/modified\s*sequence|mod\.?\s*sequence/.test(n))
        return 8;
    if (/probabilities/.test(n) && /(lactyl|phospho|acetyl|ubiquit|glyco)/.test(n))
        return 8;
    return 0;
}
function scoreGene(n) {
    if (/^hgnc$/.test(n))
        return 10;
    if (/^gene\s*names?$/.test(n))
        return 10;
    if (/^gene\s*symbols?$/.test(n))
        return 10;
    if (/^gene\s*ids?$/.test(n))
        return 8;
    if (/^genes?$/.test(n))
        return 8;
    if (/gene\s*name/.test(n))
        return 7;
    if (/gene\s*symbol/.test(n))
        return 7;
    return 0;
}
function scoreSiteCombined(n) {
    // Accession / UniProt ID columns are never combined site IDs
    // (even if a section title mentions "modification sites")
    if (/protein\s*accession|uniprot|\baccession\b/.test(n) && !/phosphosite|site\s*id|feature|mod/.test(n))
        return 0;
    if (/uniprot.*phosphosite|phosphosite.*uniprot|protein\s*\+\s*phosphosite|gene\s*name\s*\+\s*phosphosite/i.test(n))
        return 11;
    if (/^mod[_\s.-]?sites?$/.test(n))
        return 11;
    if (/modification\s*sites?/.test(n))
        return 10;
    if (/^phosphosite/.test(n))
        return 10;
    // limma / feature tables: "feature_names" holding CIC-S739
    if (/^feature[_\s-]?names?$/.test(n))
        return 10;
    if (/^features?$/.test(n))
        return 7;
    if (/p[Rr]\s*residue/.test(n))
        return 9;
    if (/^sites?$/.test(n))
        return 8;
    if (/phospho.?site|ptm.?site|mod.?site/.test(n))
        return 9;
    if (/site\s*id/.test(n))
        return 5;
    // Peptide span columns are not combined site IDs
    if (/positions?\s+in\s+(a\s+)?master\s*proteins?/.test(n))
        return 0;
    if (/accession/.test(n) && !/site|phospho|feature|mod/.test(n))
        return 0;
    return 0;
}
function isLog2Header(n) {
    return /log\s*2|log2|2\s*log|2log|^log\s*fc$|^logfc$|^log\.?\s*fc$|log\s*fc/.test(n);
}
/** Intensity / abundance columns — must NOT be treated as ratios. */
export function scoreIntensity(n) {
    if (/ratio|log\s*2|log2|fold\s*change|\bfc\b/.test(n))
        return 0;
    // Dedupe suffixes from buildHeaders (P1__2 → p1)
    const base = n.replace(/__\d+$/, "").trim();
    if (/peak\s*area|peakarea/.test(n))
        return 10;
    if (/normalized\s*abundance|abundance/.test(n))
        return 9;
    if (/\bintensity\b/.test(n))
        return 9;
    // Per-sample quantitation blocks (often under group headers P1/P5/P7)
    if (/\b(quantitation|quantity|quant\.?)\b/.test(n))
        return 8;
    // bare timepoint / channel labels like 0/5, 5/5 without ratio wording
    if (/^\d+\s*\/\s*\d+$/.test(base))
        return 8;
    // Postnatal / developmental day or bare sample channels: P1, P5, D7, Day1
    // (PMID 38479452 mmc3 — these are intensities, not contrast ratios)
    if (/^(p|d|day)\s*\d{1,2}$/.test(base))
        return 8;
    if (/^(sample|rep|replicate|bio)\s*[-_]?\s*\d+$/.test(base))
        return 8;
    if (/^(l|m|h|light|medium|heavy)$/.test(base))
        return 5;
    return 0;
}
/**
 * Drop ratioColumns that are actually intensity/abundance/sample channels.
 * Used after heuristic + LLM so bare labels like P1/P5/P7 never become fake log2FC.
 */
export function stripIntensityRatioColumns(mapping) {
    const stripped = [];
    const ratioColumns = mapping.ratioColumns.filter((r) => {
        if (r.valueType === "intensity") {
            stripped.push(r.column);
            return false;
        }
        if (scoreIntensity(norm(r.column)) >= 8) {
            stripped.push(r.column);
            return false;
        }
        return true;
    });
    if (stripped.length === 0)
        return mapping;
    const intensityColumns = [
        ...new Set([...(mapping.intensityColumns ?? []), ...stripped]),
    ];
    const intensityOnly = Boolean(mapping.intensityOnly) ||
        (ratioColumns.length === 0 && intensityColumns.length > 0);
    const note = `stripped_intensity_as_ratio=${stripped.join("|")}`;
    const notes = mapping.notes ? `${mapping.notes}; ${note}` : note;
    return {
        ...mapping,
        ratioColumns,
        intensityColumns,
        intensityOnly,
        notes,
    };
}
function scoreRatio(n) {
    // Hard reject intensity / abundance / peak area
    if (scoreIntensity(n) >= 8)
        return 0;
    // Never treat p-values / counts as ratios (even if the header mentions "ratio")
    if (scorePValue(n) >= 7)
        return 0;
    if (/variability|count|unique|razor|sequence\s*coverage|stdev|std\.?\s*dev|peptides$/.test(n))
        return 0;
    if (/number\s+of| #\s*|digly\s*peptides\s+in|peptides\s+in\s+protein/.test(n))
        return 0;
    if (/adj\.?\s*p|p[- ]?value|pvalue|q[- ]?value|fdr/.test(n))
        return 0;
    // Inverse of a ratio is redundant when the forward ratio exists
    if (/^1\s*\/\s*/.test(n) || /1\s*\/\s*(nomolized|normalized)/.test(n))
        return 3;
    // Reject bare timepoint headers (0/5) — those are intensities in many supp tables
    if (/^\d+\s*\/\s*\d+$/.test(n) && !/ratio|log|fold|fc/.test(n))
        return 0;
    let s = 0;
    if (/(log\s*2|log2|2log|2\s*log)/.test(n) && /(ratio|fc|fold)/.test(n))
        s = 10;
    // limma / common DE headers: logFC, logfc, log.FC, Log2FC
    else if (/^log\s*2?\s*fc$|^logfc$|^log\.?\s*fc$/.test(n))
        s = 9;
    else if (/abundance\s*ratio/.test(n) && !/p[- ]?value|adj/.test(n))
        s = 9;
    else if (/^ratio\b/.test(n) || /\bratio\b/.test(n))
        s = 8;
    else if (/\bfold\s*change\b|\bfc\b/.test(n))
        s = 7;
    else if (/log\s*fc|logfc/.test(n))
        s = 7;
    // PTM shorthand contrasts: Kac(ATN/Ctrl), log2 Kac(ATN/Ctrl), Lac(H/L), …
    else if (/\([^)]+\/[^)]+\)/.test(n) &&
        /\b(kac|kla|lac|di\s*gly|ub|phospho|succinyl|malonyl|crotonyl)\b/.test(n))
        s = 8;
    else if (/(log\s*2|log2|2log)/.test(n))
        s = 6;
    else if (/\baverage\b/.test(n) && /\//.test(n) && /phospho|protein|ratio/.test(n))
        s = 7;
    else if (/\baverage\b/.test(n) && /(phospho|ratio)/.test(n))
        s = 6;
    // typo "nomolized" common in some supp tables
    if (/(normalized|nomolized)/.test(n) && s > 0)
        s += 2;
    if (/protein/.test(n) && !/phospho|peptide|site|within/.test(n))
        s -= 1;
    if (/peptide|site|mod|phospho/.test(n) && s > 0)
        s += 1;
    return s;
}
function scorePValue(n) {
    if (/variability|count|intensity/.test(n))
        return 0;
    if (/significance/.test(n))
        return 8;
    if (/adj\.?\s*p|q[- ]?value|fdr/.test(n))
        return 9;
    if (/p[- ]?value|pval|\bp\b/.test(n))
        return 8;
    return 0;
}
function conditionFromRatioHeader(h, sheetName = "") {
    return conditionLabelFromRatioHeader(h, sheetName);
}
function isSilacRatioMetadataSuffix(suffix) {
    return /^(variability|count|significance|shift)\b/i.test(suffix.trim());
}
function ratioDedupKey(h, cond, level) {
    const silacSuffix = silacBiologySuffixFromHeader(h);
    if (silacSuffix && !isSilacRatioMetadataSuffix(silacSuffix)) {
        return `${level}:silac:${silacSuffix.toLowerCase().replace(/[\s_]+/g, "")}`;
    }
    return `${level}:${pairConditionKey(cond)}`;
}
function ratioIsLog2(h) {
    const n = norm(h);
    // SILAC "Ratio H/L …" columns are linear heavy/light ratios, not log2FC
    if (isSilacChannelRatioHeader(n))
        return false;
    return isLog2Header(n);
}
function pairConditionKey(cond) {
    const canon = canonicalizeConditionKey(cond);
    if (/^(m\/l|h\/l|l\/h|h\/m|l\/m|m\/h)$/i.test(cond.trim())) {
        return cond.trim().toLowerCase();
    }
    return canon || cond.toLowerCase().replace(/[()\[\]\s]+/g, "");
}
/** Prefer log2FC columns when the same biological contrast also has fold-change. */
function preferLog2RatioColumns(cols) {
    const best = new Map();
    const order = [];
    for (const r of cols) {
        const key = `${r.level}:${pairConditionKey(r.condition)}`;
        const prev = best.get(key);
        if (!prev) {
            best.set(key, r);
            order.push(key);
            continue;
        }
        const prevLog = prev.isLog2 || prev.valueType === "log2_ratio";
        const nextLog = r.isLog2 || r.valueType === "log2_ratio";
        if (nextLog && !prevLog)
            best.set(key, r);
    }
    return order.map((k) => best.get(k)).filter(Boolean);
}
/** Map ratio/p-value column conditions onto Stage3 Condition / Detail. */
export function alignConditionsToStage3(mapping, stage3Condition, detailCondition = "") {
    // Long-format: per-row condition labels come from conditionCol — do not collapse
    // the single shared logFC column onto one Stage3 fragment.
    if (mapping.conditionCol)
        return mapping;
    if ((!stage3Condition.trim() && !detailCondition.trim()) || mapping.ratioColumns.length === 0) {
        return mapping;
    }
    const originals = mapping.ratioColumns.map((r) => cleanMappedCondition(r.condition || r.column) || (r.condition || r.column));
    const alignedLabels = mapping.ratioColumns.map((r) => resolveRowCondition(r.condition || r.column, stage3Condition, detailCondition));
    // If distinct table conditions were collapsed onto one Stage3 label, restore originals.
    // Orthographic variants (ETO 30min_Ctr vs ETO 30 min/Ctr) count as the SAME original.
    const byAligned = new Map();
    for (let i = 0; i < alignedLabels.length; i++) {
        const key = canonicalizeConditionKey(alignedLabels[i]);
        const set = byAligned.get(key) ?? new Set();
        set.add(canonicalizeConditionKey(originals[i]));
        byAligned.set(key, set);
    }
    const collapsed = new Set();
    for (const [aligned, originalsSet] of byAligned) {
        if (originalsSet.size > 1)
            collapsed.add(aligned);
    }
    const ratioColumns = mapping.ratioColumns.map((r, i) => {
        const key = canonicalizeConditionKey(alignedLabels[i]);
        const condition = collapsed.has(key) ? originals[i] : alignedLabels[i];
        return { ...r, condition };
    });
    const pValueColumns = mapping.pValueColumns.map((p) => {
        const original = cleanMappedCondition(p.condition || p.column) || (p.condition || p.column);
        let condition = resolveRowCondition(p.condition || p.column, stage3Condition, detailCondition);
        const key = canonicalizeConditionKey(condition);
        if (collapsed.has(key)) {
            const matchRatio = ratioColumns.find((r) => {
                const rc = canonicalizeConditionKey(r.condition);
                const oc = canonicalizeConditionKey(original);
                return rc === oc || oc.includes(rc) || rc.includes(oc);
            });
            condition = matchRatio?.condition || original;
        }
        return { ...p, condition };
    });
    return { ...mapping, ratioColumns, pValueColumns };
}
function scoreConditionCol(n) {
    if (/^conditions?$/.test(n))
        return 10;
    if (/^contrasts?$/.test(n))
        return 10;
    if (/^comparisons?$/.test(n))
        return 9;
    if (/condition\s*(name|label|id)|contrast\s*(name|label)/.test(n))
        return 8;
    if (/^groups?$/.test(n))
        return 5;
    return 0;
}
/** Headers that hold protein identity / annotation — never long-format Condition. */
function isAnnotationHeaderName(n) {
    return (/fasta|description|accession|sequence|peptide|modificat|localization|probability|^pep$|^score$|positions?_sorted|accessions?_sorted|gene\.?names?_sorted|fasta\.?headers?_sorted|protein\.?description|protein\.?name|^protein$|^proteins$/i.test(n) || /gene\.?name/.test(n));
}
/**
 * True biological / limma-style contrast cell — not "ATP-binding …" protein prose.
 * Bare hyphens alone are NOT enough (FASTA/descriptions are full of them).
 */
function looksLikeContrastCell(v) {
    const s = (v || "").trim();
    if (!s || s.length > 120)
        return false;
    if (isAnnotationMasqueradingAsCondition(s))
        return false;
    if (/\b(?:vs\.?|versus)\b/i.test(s))
        return true;
    // Treatment/Control slash (avoid UniProt "sp|…|…" pipes)
    if (/[A-Za-z0-9).]\s*\/\s*[A-Za-z(]/.test(s) && !/^(sp|tr)\|/i.test(s))
        return true;
    if (/\b(control|ctr|ctrl|sham|vehicle|untreated|dmso|resting|stimulated|baseline)\b/i.test(s)) {
        return true;
    }
    // limma: "IGF1.10 - control.10" (spaced dash + treatment cue)
    if (/\s[-–—]\s/.test(s) &&
        /\b(control|ctr|ctrl|sham|ins(?:ulin)?|igf|veh|treat|ko|wt|mut)\b/i.test(s)) {
        return true;
    }
    return false;
}
function previewValuesForCol(preview, colIdx, maxRows = 12) {
    const out = [];
    for (const row of preview.slice(0, maxRows)) {
        const v = (row[colIdx] ?? "").trim();
        if (!v || /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v))
            continue;
        out.push(v);
    }
    return out;
}
/** Preview-detected conditionCol must look like stacked contrasts, not annotation dumps. */
function previewSupportsConditionCol(preview, colIdx) {
    const vals = previewValuesForCol(preview, colIdx);
    if (vals.length < 2)
        return false;
    const distinct = new Set(vals.map((v) => v.toLowerCase()));
    if (distinct.size < 2)
        return false;
    const contrastLike = vals.filter(looksLikeContrastCell);
    const annotationLike = vals.filter(isAnnotationMasqueradingAsCondition);
    if (annotationLike.length >= Math.ceil(vals.length * 0.5))
        return false;
    return contrastLike.length >= 2;
}
/**
 * Long-format cue: a non-ratio column whose preview values look like many distinct contrasts.
 * Never pick FASTA / description / accession columns; bare hyphens are not contrast cues.
 */
function detectConditionColFromPreview(headers, preview, skip) {
    if (!preview?.length || !headers.length)
        return null;
    let best = null;
    let bestDistinct = 0;
    for (let c = 0; c < headers.length; c++) {
        const h = headers[c];
        if (!h || skip.has(h))
            continue;
        const nh = norm(h);
        if (scoreConditionCol(nh) >= 8)
            return h;
        if (isAnnotationHeaderName(nh))
            continue;
        if (scoreRatio(nh) >= 6 || scorePValue(nh) >= 7)
            continue;
        if (!previewSupportsConditionCol(preview, c))
            continue;
        const vals = new Set(previewValuesForCol(preview, c).map((v) => v.toLowerCase()));
        if (vals.size > bestDistinct) {
            bestDistinct = vals.size;
            best = h;
        }
    }
    return best;
}
function detectSiteCombinedFromPreview(headers, preview, skip) {
    if (!preview?.length || !headers.length)
        return null;
    let best = null;
    let bestHits = 0;
    for (let c = 0; c < headers.length; c++) {
        const h = headers[c];
        if (!h || skip.has(h))
            continue;
        let hits = 0;
        let seen = 0;
        for (const row of preview.slice(0, 12)) {
            const v = (row[c] ?? "").trim();
            if (!v)
                continue;
            seen++;
            if (looksLikePhosphositeCombinedId(v))
                hits++;
        }
        if (seen >= 2 && hits / seen >= 0.6 && hits > bestHits) {
            bestHits = hits;
            best = h;
        }
    }
    return best;
}
/**
 * Build heuristic mapping for one sheet. confidence in [0,1].
 */
export function heuristicMapSheet(entryPath, sheet) {
    const headers = sheet.headers.filter(Boolean);
    const uniprotCol = findBest(headers, [scoreUniprot], 5);
    const geneCol = findBest(headers, [scoreGene], 7);
    const positionCol = findBest(headers, [scorePosition], 5);
    const aminoAcidCol = findBest(headers, [scoreAmino], 5);
    let siteCombinedCol = findBest(headers, [scoreSiteCombined], 6);
    if (!siteCombinedCol) {
        const skip = new Set([uniprotCol, geneCol, positionCol, aminoAcidCol].filter(Boolean));
        siteCombinedCol = detectSiteCombinedFromPreview(headers, sheet.preview, skip);
    }
    const modSeqCol = findBest(headers, [scoreModSequence], 7);
    let conditionCol = findBest(headers, [scoreConditionCol], 8);
    if (!conditionCol) {
        const skip = new Set([uniprotCol, geneCol, positionCol, aminoAcidCol, siteCombinedCol, modSeqCol].filter(Boolean));
        conditionCol = detectConditionColFromPreview(headers, sheet.preview, skip);
    }
    // Identity/annotation columns are never long-format Condition (Stage3 is the global fallback).
    if (conditionCol && isAnnotationHeaderName(norm(conditionCol))) {
        conditionCol = null;
    }
    const intensityColumns = headers.filter((h) => scoreIntensity(norm(h)) >= 8);
    const ratioCandidates = [];
    for (const h of headers) {
        const n = norm(h);
        const s = scoreRatio(n);
        if (s < 6)
            continue;
        const level = /protein/.test(n) && !/peptide|site|nomolized|normalized|h\/l|l\/h/.test(n)
            ? "protein"
            : "peptide";
        ratioCandidates.push({ h, score: s, level });
    }
    ratioCandidates.sort((a, b) => b.score - a.score);
    const ratioColumns = [];
    const seenCond = new Set();
    for (const r of ratioCandidates) {
        const cond = conditionFromRatioHeader(r.h, sheet.name);
        const key = ratioDedupKey(r.h, cond, r.level);
        if (seenCond.has(key))
            continue;
        const n = norm(r.h);
        if (!/(normalized|nomolized)/.test(n)) {
            const better = ratioCandidates.find((x) => x.level === r.level &&
                /(normalized|nomolized)/.test(norm(x.h)) &&
                ratioDedupKey(x.h, conditionFromRatioHeader(x.h, sheet.name), x.level) === key);
            if (better) {
                ratioColumns.push({
                    column: better.h,
                    condition: conditionFromRatioHeader(better.h, sheet.name),
                    isLog2: ratioIsLog2(better.h),
                    level: better.level,
                    valueType: ratioIsLog2(better.h) ? "log2_ratio" : "fold_change",
                });
                seenCond.add(key);
                continue;
            }
        }
        ratioColumns.push({
            column: r.h,
            condition: cond,
            isLog2: ratioIsLog2(r.h),
            level: r.level,
            valueType: ratioIsLog2(r.h) ? "log2_ratio" : "fold_change",
        });
        seenCond.add(key);
    }
    // Prefer a single peptide SILAC/normalized ratio; drop protein ratio if same H/L biology
    let peptideRatios = preferLog2RatioColumns(ratioColumns.filter((r) => r.level === "peptide")).slice(0, 12);
    let proteinRatios = preferLog2RatioColumns(ratioColumns.filter((r) => r.level === "protein")).slice(0, 8);
    if (peptideRatios.length > 0) {
        const pepKeys = new Set(peptideRatios.map((r) => pairConditionKey(r.condition)));
        proteinRatios = proteinRatios.filter((r) => {
            const k = pairConditionKey(r.condition);
            // "protein" alone or same H/L channel → redundant with peptide ratio
            if (k === "protein" || pepKeys.has(k))
                return false;
            return true;
        });
    }
    const finalRatios = [...peptideRatios, ...proteinRatios];
    const pValueColumns = [];
    for (const h of headers) {
        const n = norm(h);
        if (scorePValue(n) < 7)
            continue;
        const level = /protein/.test(n) && !/peptide|site/.test(n) ? "protein" : "peptide";
        let cond = "";
        for (const r of finalRatios) {
            if (r.level !== level)
                continue;
            const rc = pairConditionKey(r.condition);
            if (rc && pairConditionKey(h).includes(rc.replace("/", ""))) {
                cond = r.condition;
                break;
            }
            const rm = r.column.match(/ratio\s+(\S+)/i);
            const pm = h.match(/ratio\s+(\S+)/i);
            if (rm && pm && rm[1].toLowerCase() === pm[1].toLowerCase()) {
                cond = r.condition;
                break;
            }
        }
        if (!cond && finalRatios.length === 1)
            cond = finalRatios[0].condition;
        if (!cond)
            cond = conditionFromRatioHeader(h, sheet.name);
        pValueColumns.push({ column: h, condition: cond, level });
    }
    const hasSite = Boolean(positionCol || siteCombinedCol || aminoAcidCol || modSeqCol);
    const intensityOnly = finalRatios.length === 0 && intensityColumns.length > 0;
    let confidence = 0;
    if (uniprotCol)
        confidence += 0.3;
    else if (geneCol)
        confidence += 0.22;
    if (positionCol || siteCombinedCol)
        confidence += 0.3;
    else if (aminoAcidCol)
        confidence += 0.1;
    if (aminoAcidCol || siteCombinedCol || modSeqCol)
        confidence += 0.1;
    if (finalRatios.length > 0)
        confidence += 0.3;
    if (pValueColumns.length > 0)
        confidence += 0.05;
    if (!hasSite)
        confidence -= 0.35;
    if (intensityOnly)
        confidence = Math.min(confidence, 0.4);
    confidence = Math.max(0, Math.min(1, confidence));
    // Prefer siteCombined when position missing; keep both if useful
    let siteCol = siteCombinedCol;
    if (positionCol && siteCombinedCol && positionCol === siteCombinedCol)
        siteCol = null;
    // When site is in a combined GENE_S123 column, keep HGNC/gene for gene→UniProt lookup
    const keepGeneCol = Boolean(siteCol && geneCol);
    const accessionCol = uniprotCol && siteCol && uniprotCol === siteCol ? null : uniprotCol;
    const notesParts = [];
    if (!accessionCol && geneCol)
        notesParts.push("gene→UniProt");
    else if (keepGeneCol)
        notesParts.push("gene→UniProt");
    else if (!accessionCol)
        notesParts.push("no UniProt column");
    if (!positionCol && !siteCombinedCol && !aminoAcidCol && !modSeqCol)
        notesParts.push("no_site_level");
    else if (!aminoAcidCol && modSeqCol)
        notesParts.push("AA←modSeq");
    if (finalRatios.length === 0)
        notesParts.push("no ratio column");
    if (intensityOnly)
        notesParts.push("intensity_only");
    if (intensityColumns.length > 0 && finalRatios.length === 0) {
        notesParts.push(`intensity_cols=${intensityColumns.slice(0, 6).join("|")}`);
    }
    if (finalRatios.length > 1)
        notesParts.push(`${finalRatios.length} ratio conditions`);
    if (conditionCol)
        notesParts.push(`long_format_condition=${conditionCol}`);
    return {
        entryPath,
        sheetName: sheet.name,
        headerRowIndex: sheet.headerRowIndex ?? 0,
        confidence,
        source: "heuristic",
        uniprotCol: accessionCol,
        geneCol: keepGeneCol || !accessionCol ? geneCol : null,
        positionCol,
        aminoAcidCol,
        siteCombinedCol: positionCol && !siteCombinedCol ? null : siteCol,
        conditionCol: conditionCol || null,
        modSeqCol: aminoAcidCol ? null : modSeqCol,
        ratioColumns: finalRatios,
        pValueColumns: pValueColumns.slice(0, 24),
        intensityOnly,
        intensityColumns,
        notes: notesParts.join("; "),
    };
}
/** High enough to parse without LLM */
export const HEURISTIC_HIGH = 0.72;
/** Worth attempting parse after LLM fails if still usable */
export const HEURISTIC_MIN_PARSE = 0.55;
/** Parsable into qratio with UniProt (or gene→UniProt) + true ratio cols + site signal.
 * A siteCombinedCol that embeds accession/gene + residue (e.g. Q4VWZ5-K81 / GENE_S15)
 * satisfies both ID and site — parse-rows splits it. */
export function mappingIsParsable(m) {
    if (m.intensityOnly && !(m.derivedContrasts && m.derivedContrasts.length > 0))
        return false;
    if (m.ratioColumns.some((r) => r.valueType === "intensity") && !(m.derivedContrasts?.length))
        return false;
    const hasSite = Boolean(m.positionCol || m.siteCombinedCol || m.aminoAcidCol || m.modSeqCol);
    const hasId = Boolean(m.uniprotCol || m.geneCol || m.siteCombinedCol);
    const hasRatio = m.ratioColumns.length > 0 || Boolean(m.derivedContrasts && m.derivedContrasts.length > 0);
    return hasId && hasRatio && hasSite;
}
export function mappingNeedsManual(m) {
    if (m.intensityOnly)
        return false;
    if (!mappingIsParsable(m))
        return true;
    if (m.confidence < 0.45)
        return true;
    return false;
}
/**
 * Prefer true residue-number columns (e.g. "Protein: Modified lysine") over
 * peptide-span / accession columns that LLMs often mis-map as Position.
 *
 * Also repairs a common phospho layout: columns STY (residue S/T/Y) + AA (site
 * number). Bare "AA" scores as amino-acid by name, but when STY is present AA
 * is the position.
 */
export function repairSiteColumnMapping(mapping, headers) {
    const styCol = headers.find((h) => {
        const n = norm(h);
        return /^sty$/.test(n) || /^s\s*\/\s*t\s*\/\s*y$/.test(n) || /^residue\s*types?$/.test(n);
    }) || null;
    const aaCol = headers.find((h) => /^aa$/.test(norm(h))) || null;
    if (styCol && aaCol) {
        const notes = `${mapping.notes}; sty_aa:${styCol}+${aaCol}`.replace(/^; /, "");
        return {
            ...mapping,
            aminoAcidCol: styCol,
            positionCol: aaCol,
            notes,
        };
    }
    const bestPos = findBest(headers, [scorePosition], 5);
    if (!bestPos)
        return mapping;
    const bestScore = scorePosition(norm(bestPos));
    const curPos = mapping.positionCol;
    const curScore = curPos ? scorePosition(norm(curPos)) : 0;
    const curSite = mapping.siteCombinedCol;
    const curSiteScore = curSite ? scoreSiteCombined(norm(curSite)) : 0;
    // Upgrade when a much better residue-number column exists
    if (bestScore >= 10 && bestScore > curScore + 2) {
        const notes = `${mapping.notes}; repaired_position:${bestPos}`.replace(/^; /, "");
        return {
            ...mapping,
            positionCol: bestPos,
            // Drop weak peptide-span siteCombined when we have a real position col
            siteCombinedCol: curSiteScore <= 0 || (curSite != null && /master\s*proteins?|positions?\s+in/.test(norm(curSite)))
                ? null
                : mapping.siteCombinedCol,
            notes,
        };
    }
    // Drop siteCombined that is clearly a peptide span / accession
    if (curSite && scoreSiteCombined(norm(curSite)) <= 0) {
        return {
            ...mapping,
            siteCombinedCol: null,
            positionCol: mapping.positionCol || (bestScore >= 7 ? bestPos : mapping.positionCol),
            notes: `${mapping.notes}; dropped_bad_siteCombined`.replace(/^; /, ""),
        };
    }
    return mapping;
}
function normHeaderForHint(h) {
    return (h || "").toLowerCase().replace(/[\s_]+/g, " ").trim();
}
function findHeaderByName(headers, hint) {
    if (!hint)
        return null;
    // Positional aliases (col_1 / column 1) and exact names — shared with parse-rows.
    const resolved = resolveColumnName(headers, hint);
    if (resolved)
        return resolved;
    const nh = normHeaderForHint(hint);
    if (!nh)
        return null;
    let hit = headers.find((h) => normHeaderForHint(h) === nh);
    if (hit)
        return hit;
    // Prefer substantial overlap; avoid short tokens like "phos" matching
    // "Protein + Phosphosite" via substring.
    if (nh.length < 5)
        return null;
    hit = headers.find((h) => {
        const n = normHeaderForHint(h);
        if (n.includes(nh) && nh.length >= Math.min(8, n.length))
            return true;
        if (nh.includes(n) && n.length >= 5)
            return true;
        return false;
    });
    return hit ?? null;
}
/**
 * Apply free-text column role hints (e.g. "column AA is position") onto a mapping.
 */
export function applyColumnRoleHints(mapping, headers, roles) {
    if (!roles)
        return mapping;
    const uni = findHeaderByName(headers, roles.uniprotCol);
    const gene = findHeaderByName(headers, roles.geneCol);
    const pos = findHeaderByName(headers, roles.positionCol);
    const aa = findHeaderByName(headers, roles.aminoAcidCol);
    const siteComb = findHeaderByName(headers, roles.siteCombinedCol);
    const condCol = findHeaderByName(headers, roles.conditionCol);
    if (!uni && !gene && !pos && !aa && !siteComb && !condCol)
        return mapping;
    const bits = [];
    if (uni)
        bits.push(`uniprot=${uni}`);
    if (gene)
        bits.push(`gene=${gene}`);
    if (pos)
        bits.push(`pos=${pos}`);
    if (aa)
        bits.push(`aa=${aa}`);
    if (siteComb)
        bits.push(`siteCombined=${siteComb}`);
    if (condCol)
        bits.push(`conditionCol=${condCol}`);
    let confidence = mapping.confidence;
    const gainedSite = Boolean(siteComb && !mapping.siteCombinedCol && !mapping.positionCol);
    if (gainedSite)
        confidence = Math.min(1, Math.max(confidence, 0.55) + 0.25);
    const notes = `${mapping.notes}; role_hint:${bits.join("|")}`
        .replace(/\bno_site_level;?\s*/gi, siteComb || pos ? "" : "no_site_level;")
        .replace(/^; /, "")
        .replace(/;\s*;/g, ";");
    // User-taught combined site column: prefer splitting that one column over
    // stale heuristic uniprot/position picks that conflict with the Teach note.
    if (siteComb) {
        return {
            ...mapping,
            uniprotCol: uni && uni !== siteComb ? uni : mapping.uniprotCol === siteComb ? null : mapping.uniprotCol,
            geneCol: gene && gene !== siteComb ? gene : mapping.geneCol === siteComb ? null : mapping.geneCol,
            // Position / AA come from splitting siteCombined — clear separate cols when
            // the Teach note says this one column holds UniProt+AA+Position.
            positionCol: pos && pos !== siteComb ? pos : null,
            aminoAcidCol: aa && aa !== siteComb ? aa : null,
            siteCombinedCol: siteComb,
            conditionCol: condCol || mapping.conditionCol || null,
            confidence,
            notes,
        };
    }
    return {
        ...mapping,
        uniprotCol: uni || mapping.uniprotCol,
        geneCol: gene || mapping.geneCol,
        positionCol: pos || mapping.positionCol,
        aminoAcidCol: aa || mapping.aminoAcidCol,
        siteCombinedCol: mapping.siteCombinedCol,
        conditionCol: condCol || mapping.conditionCol || null,
        confidence,
        notes,
    };
}
/**
 * Force user-named columns into the mapping as protein-level ratio / p-value
 * (e.g. hints.proteomeColumns = { ratioCol: "total proteome Log(ASB2/MCS)",
 * pValueCol: "total proteome p-value" }). Users know which columns hold the
 * whole-proteome quantitation; the LLM often drops them, leaving Log2Ratio
 * (protein) empty.
 */
export function applyProteomeColumnHints(mapping, headers, hints) {
    const pc = hints?.proteomeColumns;
    const ratioHint = findHeaderByName(headers, pc?.ratioCol);
    const pvHint = findHeaderByName(headers, pc?.pValueCol);
    if (!ratioHint && !pvHint)
        return mapping;
    const ratioColumns = [...mapping.ratioColumns];
    const pValueColumns = [...mapping.pValueColumns];
    // Reference condition: reuse the first peptide ratio's condition if present,
    // else the first ratio, else empty (Stage3 condition alignment will fill it).
    const refCond = ratioColumns.find((r) => r.level === "peptide")?.condition ||
        ratioColumns[0]?.condition ||
        "";
    const isLog2 = (h) => /log\s*2|log2|2\s*log|\blog\b/i.test(h);
    if (ratioHint) {
        const exists = ratioColumns.find((r) => normHeaderForHint(r.column) === normHeaderForHint(ratioHint));
        if (!exists) {
            ratioColumns.push({
                column: ratioHint,
                condition: refCond,
                isLog2: isLog2(ratioHint),
                level: "protein",
                valueType: isLog2(ratioHint) ? "log2_ratio" : "fold_change",
            });
        }
        else if (exists.level !== "protein") {
            exists.level = "protein";
        }
    }
    if (pvHint) {
        const exists = pValueColumns.find((p) => normHeaderForHint(p.column) === normHeaderForHint(pvHint));
        if (!exists) {
            pValueColumns.push({ column: pvHint, condition: refCond, level: "protein" });
        }
        else if (exists.level !== "protein") {
            exists.level = "protein";
        }
    }
    const notes = mapping.notes
        ? `${mapping.notes}; proteome_hint=${ratioHint || "—"}|${pvHint || "—"}`
        : `proteome_hint=${ratioHint || "—"}|${pvHint || "—"}`;
    return { ...mapping, ratioColumns, pValueColumns, notes };
}
