import { canonicalizeConditionKey, resolveRowCondition } from "./condition.js";
import { mapGenesToUniprot, normalizeGeneSymbol } from "./gene-uniprot.js";
import { resolveSingleModification } from "./ptm.js";
import { buildSilacGenotypeContrasts, silacGenotypeLog2Fc, } from "./silac-contrast.js";
import { derivedIntensityLog2Fc } from "./derived-ratio.js";
import { isValidUniprotAccession, parsePhosphositeCombinedId } from "./phosphosite-id.js";
import { resolveRowSample, resolveSheetAsSample } from "./sample-map.js";
import { loadSheetData, resolveColumnIndex } from "./tables.js";
export { resolveRowSample, resolveSheetAsSample } from "./sample-map.js";
export { buildConditionSampleMap, inferSampleFromCondition, lookupConditionSample, parseConditionSampleMap, } from "./sample-map.js";
export const QRATIO_CSV_HEADER = [
    "PMID",
    "Sample",
    "Sample type",
    "Organism",
    "PTMs",
    "Condition",
    "UniProt ID",
    "Position",
    "Amino acid",
    "Log2Ratio (site)",
    "P value (site)",
    "Log2Ratio (protein)",
    "P value (protein)",
];
/**
 * Parse a site token like S15 / K374 / Y132*.
 * Never treat a UniProt accession (P32783) or peptide span (P32783 [357-382]) as a site.
 */
export function parseSiteToken(text) {
    const t = (text || "").trim();
    if (!t)
        return null;
    // UniProt accession alone (P32783, Q00955-2, …)
    if (isValidUniprotAccession(t))
        return null;
    // Peptide / protein span: "P32783 [357-382]" or "ACC[12-34]"
    if (/^[A-Z0-9-]+\s*\[\d+\s*[-–]\s*\d+\]$/i.test(t))
        return null;
    // Prefer explicit residue forms before a loose letter+digits match
    const explicit = t.match(/^([A-Za-z])(\d{1,5})\*?$/) ||
        t.match(/\b([STYKROCN])(\d{1,5})\*?\b/i) ||
        t.match(/\[([A-Za-z])(\d{1,5})\]/);
    if (explicit) {
        const aa = explicit[1].toUpperCase();
        const pos = explicit[2];
        if (!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(aa))
            return null;
        // Reject if letter+digits reconstitutes a UniProt accession (P + 32783)
        if (isValidUniprotAccession(`${aa}${pos}`))
            return null;
        return { aa, pos };
    }
    // Gene + site with AA after position: "Myh6 1772K", "Obscn 1601K", "1772K"
    const aaAfter = t.match(/\b[A-Za-z][\w.-]*\s+(\d{1,5})\s*([ACDEFGHIKLMNPQRSTVWY])\b/i) ||
        t.match(/\b(\d{2,5})\s*([ACDEFGHIKLMNPQRSTVWY])\b/i);
    if (aaAfter) {
        const pos = aaAfter[1];
        const aa = aaAfter[2].toUpperCase();
        if (/^[ACDEFGHIKLMNPQRSTVWY]$/.test(aa) && !isValidUniprotAccession(`${aa}${pos}`)) {
            return { aa, pos };
        }
    }
    const m = t.match(/\b([A-Za-z])(\d{1,5})\*?/);
    if (!m)
        return null;
    const aa = m[1].toUpperCase();
    const pos = m[2];
    if (!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(aa))
        return null;
    if (isValidUniprotAccession(`${aa}${pos}`))
        return null;
    return { aa, pos };
}
/** True when AA+Position is clearly a mis-parsed UniProt accession. */
export function looksLikeUniprotAsSite(uid, aa, pos) {
    const a = (aa || "").trim().toUpperCase();
    const p = (pos || "").trim();
    const u = (uid || "").trim().toUpperCase();
    if (!a || !p || !u)
        return false;
    if (u === `${a}${p}`)
        return true;
    if (isValidUniprotAccession(`${a}${p}`) && u.startsWith(a) && u.endsWith(p.replace(/^0+/, "") || p)) {
        return true;
    }
    return false;
}
/** Infer AA from diGly / modification annotations, e.g. `1xGG [K18]` → K. */
export function inferAaFromModAnnotation(text) {
    const t = (text || "").trim();
    if (!t)
        return null;
    const gg = t.match(/(?:glygly|gg|ubi)\s*\[([A-Za-z])/i) || t.match(/\[([A-Za-z])\d*\]/);
    if (gg) {
        const aa = gg[1].toUpperCase();
        if (/^[ACDEFGHIKLMNPQRSTVWY]$/.test(aa))
            return aa;
    }
    return null;
}
/** Default residue letter from PTM type / position column name when only a number is known. */
export function inferAaFromContext(opts) {
    const fromMod = inferAaFromModAnnotation(opts.modAnnotation || "");
    if (fromMod)
        return fromMod;
    const col = (opts.positionCol || "").toLowerCase();
    if (/lysine|\blys\b|\bk\b/.test(col))
        return "K";
    if (/serine|\bser\b/.test(col))
        return "S";
    if (/threonine|\bthr\b/.test(col))
        return "T";
    if (/tyrosine|\btyr\b/.test(col))
        return "Y";
    if (/arginine|\barg\b/.test(col))
        return "R";
    const ptm = (opts.ptms || "").toLowerCase();
    if (/ubiquit|acetyl|succinyl|malonyl|crotonyl|lactyl|sumo|methyl/.test(ptm))
        return "K";
    return "";
}
/**
 * Infer modified amino acid from MaxQuant-style probability strings, e.g.
 * `PEVSSK(1)GATISK` or `AK(0.998)K(0.002)PAAAAGAK` → K (highest probability).
 */
export function inferAaFromModSequence(text) {
    const t = (text || "").trim();
    if (!t)
        return null;
    let bestAa = null;
    let bestP = -1;
    const re = /([A-Za-z])\(([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\)/g;
    let m;
    while ((m = re.exec(t)) !== null) {
        const aa = m[1].toUpperCase();
        if (!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(aa))
            continue;
        const p = Number(m[2]);
        if (!Number.isFinite(p))
            continue;
        if (p > bestP) {
            bestP = p;
            bestAa = aa;
        }
    }
    return bestAa;
}
function firstUniprot(raw) {
    const parts = raw.split(/[;,\s|/]+/).map((x) => x.trim()).filter(Boolean);
    for (const p of parts) {
        const combined = parsePhosphositeCombinedId(p);
        if (combined?.isUniprotAcc)
            return combined.geneOrAcc;
        // Prefer first UniProt-like token; also accept IPI / yeast ORF as ID for Stage5
        const m = p.match(/(?:sp|tr)\|([A-Z0-9]+)/i) ||
            p.match(/\bIPI:?\s*(IPI[0-9.]+)\b/i) ||
            p.match(/\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})\b/) ||
            p.match(/\b(Y[A-P][LR][0-9]{3}[CW])\b/i);
        if (m) {
            const id = (m[1] ?? m[0]).toUpperCase();
            if (isValidUniprotAccession(id))
                return id;
        }
        if (/^IPI[0-9.]+$/i.test(p))
            return p.toUpperCase();
        if (isValidUniprotAccession(p))
            return p.toUpperCase();
        if (/^[A-Z0-9]{5,12}(?:-\d+)?$/i.test(p) && isValidUniprotAccession(p))
            return p.toUpperCase();
    }
    return "";
}
function lookupGene(geneMap, symbol) {
    const g = normalizeGeneSymbol(symbol);
    if (!g || !geneMap)
        return "";
    return (geneMap.get(g) ||
        geneMap.get(g.toLowerCase()) ||
        [...geneMap.entries()].find(([k]) => k.toLowerCase() === g.toLowerCase())?.[1] ||
        "");
}
function colIndex(headers, name) {
    return resolveColumnIndex(headers, name);
}
function findUniprotKbIndex(headers) {
    const exact = headers.findIndex((h) => /^uniprotkb$/i.test((h || "").trim()));
    if (exact >= 0)
        return exact;
    return headers.findIndex((h) => /uniprotkb/i.test(h || ""));
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
function pickPValue(mapping, headers, row, condition, level) {
    const condKey = condition.toLowerCase().replace(/\s+/g, "");
    const candidates = mapping.pValueColumns.filter((p) => p.level === level);
    let hit = candidates.find((p) => p.condition.toLowerCase().replace(/\s+/g, "") === condKey) ??
        candidates.find((p) => {
            const pc = p.condition.toLowerCase().replace(/\s+/g, "");
            return pc && (condKey.includes(pc) || pc.includes(condKey));
        });
    if (!hit && candidates.length === 1) {
        // Long-format / single p-value column shared across all contrasts
        hit = candidates[0];
    }
    if (!hit)
        return "";
    const idx = colIndex(headers, hit.column);
    if (idx < 0)
        return "";
    const n = parseNumber(row[idx] ?? "");
    return fmtNum(n);
}
export function parseMappedSheet(opts) {
    return parseMappedSheetAsync(opts);
}
async function parseMappedSheetAsync(opts) {
    opts.onProgress?.(`Loading sheet “${opts.mapping.sheetName}” (large tables may take a few minutes)…`);
    const { headers, rows } = loadSheetData(opts.localPath, opts.mapping.sheetName, opts.maxRows, opts.mapping.headerRowIndex);
    if (!headers.length)
        return [];
    opts.onProgress?.(`Loaded ${rows.length.toLocaleString()} data row(s) from “${opts.mapping.sheetName}”.`);
    const m = opts.mapping;
    const sheetSample = resolveSheetAsSample(m.sheetName, opts.lit.sample, Boolean(opts.preferSheetAsSample));
    // qPTM Modification column: exactly one PTM type per quantitative row
    const singlePtm = resolveSingleModification({
        litPtms: opts.lit.ptms,
        sheetName: m.sheetName,
        headers,
        enrichmentMethod: opts.lit.enrichmentMethod,
    });
    const uIdx = colIndex(headers, m.uniprotCol);
    const gIdx = colIndex(headers, m.geneCol);
    const posIdx = colIndex(headers, m.positionCol);
    const aaIdx = colIndex(headers, m.aminoAcidCol);
    const siteIdx = colIndex(headers, m.siteCombinedCol);
    const modSeqIdx = colIndex(headers, m.modSeqCol ?? null);
    const condIdx = colIndex(headers, m.conditionCol ?? null);
    const uniprotKbIdx = findUniprotKbIndex(headers);
    if (uIdx < 0 && gIdx < 0 && siteIdx < 0 && uniprotKbIdx < 0)
        return [];
    let geneMap = opts.geneToUniprot;
    const genesForLookup = [];
    if (gIdx >= 0) {
        for (const row of rows) {
            const raw = row[gIdx] ?? "";
            const combined = parsePhosphositeCombinedId(raw);
            if (combined && !combined.isUniprotAcc) {
                genesForLookup.push(combined.geneOrAcc);
                continue;
            }
            const g = normalizeGeneSymbol(raw);
            if (g)
                genesForLookup.push(g);
        }
    }
    else {
        // Only scan combined site cells when there is no dedicated gene column
        if (uIdx >= 0) {
            for (const row of rows) {
                const combined = parsePhosphositeCombinedId(row[uIdx] ?? "");
                if (combined && !combined.isUniprotAcc)
                    genesForLookup.push(combined.geneOrAcc);
            }
        }
        if (siteIdx >= 0 && siteIdx !== uIdx) {
            for (const row of rows) {
                const combined = parsePhosphositeCombinedId(row[siteIdx] ?? "");
                if (combined && !combined.isUniprotAcc)
                    genesForLookup.push(combined.geneOrAcc);
            }
        }
    }
    if (!geneMap && genesForLookup.length > 0) {
        const uniqCount = new Set(genesForLookup.map(normalizeGeneSymbol).filter(Boolean)).size;
        opts.onProgress?.(`Mapping ${uniqCount.toLocaleString()} gene symbol(s) → UniProt…`);
        geneMap = await mapGenesToUniprot([...new Set(genesForLookup)], opts.lit.organism, {
            onProgress: (done, total) => {
                if (done === total || done % 200 === 0 || done === 1) {
                    opts.onProgress?.(`Gene→UniProt ${done.toLocaleString()}/${total.toLocaleString()}…`);
                }
            },
        });
        opts.onProgress?.(`Gene→UniProt done: ${geneMap.size.toLocaleString()} symbol(s) resolved.`);
    }
    const peptideRatios = m.ratioColumns.filter((r) => r.level === "peptide");
    const proteinRatios = m.ratioColumns.filter((r) => r.level === "protein");
    // Drive row expansion from peptide ratios when present; else protein
    const drivers = peptideRatios.length > 0 ? peptideRatios : proteinRatios;
    const derivedContrasts = m.derivedContrasts ?? [];
    if (drivers.length === 0 && derivedContrasts.length === 0)
        return [];
    // Optional modification-annotation column (e.g. "Peptide: Modifications" with 1xGG [K18])
    const modAnnIdx = headers.findIndex((h) => {
        const n = (h || "").toLowerCase();
        return (/^peptide:\s*modifications$/.test(n) ||
            /^modifications?$/.test(n) ||
            (/modifications?/.test(n) && !/position|probability|prob/.test(n)));
    });
    const useSilacContrasts = /silac/i.test(opts.lit.labelMethod || "");
    const silacContrasts = useSilacContrasts && drivers.length > 0 ? buildSilacGenotypeContrasts(drivers) : [];
    const out = [];
    const yieldEvery = 10_000;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        if (rowIndex > 0 && rowIndex % yieldEvery === 0) {
            opts.onProgress?.(`Scanning rows ${rowIndex.toLocaleString()}/${rows.length.toLocaleString()} (${out.length.toLocaleString()} kept)…`);
            await new Promise((r) => setImmediate(r));
        }
        let uid = "";
        let position = posIdx >= 0 ? (row[posIdx] ?? "").trim() : "";
        let aminoAcid = aaIdx >= 0 ? (row[aaIdx] ?? "").trim() : "";
        // Position column that is actually a UniProt accession → ignore
        if (position && (isValidUniprotAccession(position) || /^[OPQ][0-9]/i.test(position))) {
            position = "";
        }
        // Non-numeric garbage / NA in Modified lysine
        if (position && /^(na|n\/a|null|-|none)$/i.test(position))
            position = "";
        const combinedSources = [
            uIdx >= 0 ? row[uIdx] : "",
            siteIdx >= 0 && siteIdx !== uIdx ? row[siteIdx] : "",
            // Gene column may actually hold combined IDs (GENE-S330) when hints/LLM
            // label a site-combined column as both gene + site.
            gIdx >= 0 && gIdx !== uIdx && gIdx !== siteIdx ? row[gIdx] : "",
        ];
        let geneFromCombined = "";
        for (const raw of combinedSources) {
            const combined = parsePhosphositeCombinedId(raw ?? "");
            if (!combined)
                continue;
            if (!position)
                position = combined.position;
            if (!aminoAcid)
                aminoAcid = combined.aminoAcid;
            if (combined.isUniprotAcc)
                uid = combined.geneOrAcc;
            else if (!geneFromCombined)
                geneFromCombined = combined.geneOrAcc;
        }
        // The mapped Position column may itself hold combined ACC_AA### values
        // (e.g. "Uniprot_diGly position" → "E9Q1G8_K235", or "CIC-S739").
        if (position && !/^\d+$/.test(position)) {
            const combined = parsePhosphositeCombinedId(position);
            if (combined) {
                if (combined.isUniprotAcc)
                    uid = combined.geneOrAcc;
                else if (!geneFromCombined)
                    geneFromCombined = combined.geneOrAcc;
                position = combined.position;
                aminoAcid = combined.aminoAcid;
            }
        }
        if (!uid && uIdx >= 0) {
            const rawU = row[uIdx] ?? "";
            const combinedInU = parsePhosphositeCombinedId(rawU);
            if (!combinedInU || combinedInU.isUniprotAcc) {
                const u = firstUniprot(rawU);
                if (u && isValidUniprotAccession(u))
                    uid = u;
            }
        }
        if (!uid && gIdx >= 0) {
            uid = lookupGene(geneMap, row[gIdx] ?? "");
        }
        if (!uid && geneFromCombined) {
            uid = lookupGene(geneMap, geneFromCombined);
        }
        if (!uid && uniprotKbIdx >= 0) {
            const u = firstUniprot(row[uniprotKbIdx] ?? "");
            if (u && isValidUniprotAccession(u))
                uid = u;
        }
        if (!uid || !isValidUniprotAccession(uid))
            continue;
        if ((!position || !aminoAcid) && siteIdx >= 0) {
            const combinedSite = parsePhosphositeCombinedId(row[siteIdx] ?? "");
            if (combinedSite) {
                if (!aminoAcid)
                    aminoAcid = combinedSite.aminoAcid;
                if (!position)
                    position = combinedSite.position;
            }
            else {
                const site = parseSiteToken(row[siteIdx] ?? "");
                if (site) {
                    if (!aminoAcid)
                        aminoAcid = site.aa;
                    if (!position)
                        position = site.pos;
                }
            }
        }
        // AminoAcid or Position cell may itself be "S624" / "Y132*"
        if (aminoAcid && (!position || aminoAcid.length > 1)) {
            const site = parseSiteToken(aminoAcid);
            if (site) {
                aminoAcid = site.aa;
                if (!position)
                    position = site.pos;
            }
        }
        if (position && !aminoAcid) {
            const site = parseSiteToken(position);
            if (site) {
                aminoAcid = site.aa;
                position = site.pos;
            }
        }
        // MaxQuant: AA hidden in "Lactylation Probabilities" / Modified sequence
        if (!aminoAcid && modSeqIdx >= 0) {
            aminoAcid = inferAaFromModSequence(row[modSeqIdx] ?? "") || "";
        }
        // Digits-only position (e.g. Modified lysine = 374) — keep digits, infer AA
        if (position) {
            const dig = position.match(/^\d{1,5}$/) || position.match(/\b(\d{1,5})\b/);
            if (dig)
                position = dig[1] ?? dig[0];
            else if (isValidUniprotAccession(position))
                position = "";
        }
        if (!aminoAcid || aminoAcid.length > 1) {
            const modAnn = modAnnIdx >= 0 ? (row[modAnnIdx] ?? "") : "";
            aminoAcid =
                inferAaFromContext({
                    ptms: singlePtm || opts.lit.ptms,
                    positionCol: m.positionCol,
                    modAnnotation: modAnn,
                }) || (aminoAcid.length === 1 ? aminoAcid : "");
        }
        // Reject UniProt-as-site mis-parses (P32783 → P/32783)
        if (looksLikeUniprotAsSite(uid, aminoAcid, position)) {
            position = "";
            aminoAcid = "";
            continue;
        }
        // Hard gate: site-level Position is required; AminoAcid may be filled later from sequence.
        if (!position)
            continue;
        if (aminoAcid) {
            if (aminoAcid.length > 1)
                aminoAcid = aminoAcid[0].toUpperCase();
        }
        // Strip non-digits from position when possible
        if (position) {
            const dig = position.match(/\d{1,5}/);
            if (dig)
                position = dig[0];
        }
        if (!position)
            continue;
        // Final UniProt-as-site guard after digit strip
        if (looksLikeUniprotAsSite(uid, aminoAcid, position))
            continue;
        // Position must be a plausible residue index (not a 5-digit accession fragment)
        const posN = Number(position);
        if (!Number.isFinite(posN) || posN < 1 || posN > 50000)
            continue;
        if (position.length >= 5 && isValidUniprotAccession(`${aminoAcid || "X"}${position}`))
            continue;
        if (silacContrasts.length > 0) {
            for (const contrast of silacContrasts) {
                const tIdx = colIndex(headers, contrast.treat.column);
                const rIdx = colIndex(headers, contrast.ref.column);
                if (tIdx < 0 || rIdx < 0)
                    continue;
                const treatN = parseNumber(row[tIdx] ?? "");
                const refN = parseNumber(row[rIdx] ?? "");
                if (treatN == null || refN == null)
                    continue;
                const log2 = silacGenotypeLog2Fc(treatN, refN, Boolean(contrast.treat.isLog2), Boolean(contrast.ref.isLog2));
                if (log2 == null)
                    continue;
                const condition = resolveRowCondition(contrast.condition, opts.lit.condition || opts.fallbackCondition || "", opts.lit.detailCondition || "");
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
                    position,
                    aminoAcid,
                    log2RatioPeptide: fmtNum(log2),
                    pValuePeptide: "",
                    log2RatioProtein: "",
                    pValueProtein: "",
                });
            }
            continue;
        }
        if (derivedContrasts.length > 0) {
            for (const contrast of derivedContrasts) {
                const nIdx = colIndex(headers, contrast.numeratorCol);
                const dIdx = colIndex(headers, contrast.denominatorCol);
                if (nIdx < 0 || dIdx < 0)
                    continue;
                const numN = parseNumber(row[nIdx] ?? "");
                const denN = parseNumber(row[dIdx] ?? "");
                if (numN == null || denN == null)
                    continue;
                const value = derivedIntensityLog2Fc(numN, denN, Boolean(contrast.isLog2));
                if (value == null)
                    continue;
                const log2 = contrast.isLog2 ? value : toLog2(value, false);
                if (log2 == null)
                    continue;
                const condition = resolveRowCondition(contrast.condition, opts.lit.condition || opts.fallbackCondition || "", opts.lit.detailCondition || "");
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
                    position,
                    aminoAcid,
                    log2RatioPeptide: fmtNum(log2),
                    pValuePeptide: "",
                    log2RatioProtein: "",
                    pValueProtein: "",
                });
            }
            continue;
        }
        for (const ratio of drivers) {
            if (ratio.valueType === "intensity")
                continue;
            const rIdx = colIndex(headers, ratio.column);
            if (rIdx < 0)
                continue;
            const rawN = parseNumber(row[rIdx] ?? "");
            if (rawN == null)
                continue;
            const log2 = toLog2(rawN, Boolean(ratio.isLog2) || ratio.valueType === "log2_ratio");
            if (log2 == null)
                continue;
            let log2Pep = "";
            let pPep = "";
            let log2Prot = "";
            let pProt = "";
            if (ratio.level === "peptide") {
                log2Pep = fmtNum(log2);
                pPep = pickPValue(m, headers, row, ratio.condition, "peptide");
                // attach matching protein ratio for same condition if any
                const prot = proteinRatios.find((p) => p.condition.toLowerCase().replace(/\s+/g, "") ===
                    ratio.condition.toLowerCase().replace(/\s+/g, ""));
                if (prot && prot.valueType !== "intensity") {
                    const pIdx = colIndex(headers, prot.column);
                    if (pIdx >= 0) {
                        const pn = parseNumber(row[pIdx] ?? "");
                        if (pn != null) {
                            log2Prot = fmtNum(toLog2(pn, Boolean(prot.isLog2) || prot.valueType === "log2_ratio"));
                        }
                    }
                    pProt = pickPValue(m, headers, row, ratio.condition, "protein");
                }
            }
            else {
                log2Prot = fmtNum(log2);
                pProt = pickPValue(m, headers, row, ratio.condition, "protein");
            }
            const rowCond = condIdx >= 0 ? (row[condIdx] ?? "").trim() : "";
            const condition = resolveRowCondition(rowCond || ratio.condition?.trim() || "", opts.lit.condition || opts.fallbackCondition || "", opts.lit.detailCondition || "");
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
                position,
                aminoAcid,
                log2RatioPeptide: log2Pep,
                pValuePeptide: pPep,
                log2RatioProtein: log2Prot,
                pValueProtein: pProt,
            });
        }
    }
    return out;
}
export function qratioToCsvLine(r) {
    const cells = [
        r.pmid,
        r.sample,
        r.sampleType,
        r.organism,
        r.ptms,
        r.condition,
        r.uniprotId,
        r.position,
        r.aminoAcid,
        r.log2RatioPeptide,
        r.pValuePeptide,
        r.log2RatioProtein,
        r.pValueProtein,
    ];
    return cells.map(csvEscape).join(",");
}
/**
 * Normalize a condition label for dedupe so redundant variants of the same
 * biological comparison collapse into one record:
 *   "ASB2β overexpression/CON (normalized)" → "ASB2β overexpression/CON"
 *   "… Normalized to Total …" → "…"
 * These come from one table exposing both a raw ratio and its total-protein
 * normalized variant — for qPTM they are one site×condition row.
 */
function normalizeDedupeCondition(cond) {
    const cleaned = (cond || "")
        .replace(/\s*\(\s*normalized\s*\)\s*$/i, "")
        .replace(/\s+normalized\s+to\s+total\s*$/i, "")
        .replace(/\s+normalized\s*$/i, "")
        .replace(/[-_ ]*normalizedtotal$/i, "")
        .replace(/[()\s]+$/g, "")
        .trim();
    // Orthographic variants of the same biology share one key
    return canonicalizeConditionKey(cleaned) || cleaned.toLowerCase();
}
/** True when a condition label explicitly marks a normalized variant. */
function isNormalizedCondition(cond) {
    return /normalized|normalised/i.test(cond || "");
}
/**
 * Drop duplicate site-level rows: keep one row per (sample, condition, Modification,
 * UniProt ID, amino acid, position), where "normalized" variants of a condition are
 * merged into the same record. When several ratio columns were mapped onto the same
 * contrast (e.g. "diGly Log(ASB2/MCS)" and "diGly Normalized to Total …"),
 * each previously produced a row — users expect one quantitative record per
 * site per sample per condition per modification. Sample and Modification are part
 * of the key so the same residue measured in different cell lines / tissues, or
 * with different PTMs, is kept separately.
 * Non-empty protein-level fields are merged onto the kept row so no data is
 * lost; the primary (non-normalized) row's values win.
 */
export function dedupeQratioRows(rows) {
    const kept = [];
    const indexByKey = new Map();
    const keyOf = (r) => `${(r.sample || "").trim().toLowerCase()}\u0000${normalizeDedupeCondition(r.condition)}\u0000${(r.ptms || "").trim().toLowerCase()}\u0000${r.uniprotId}\u0000${r.aminoAcid}\u0000${r.position}`;
    const merge = (a, b) => {
        const aMain = !isNormalizedCondition(a.condition);
        const bMain = !isNormalizedCondition(b.condition);
        // Primary (non-normalized) row's values are preferred; fall back to the other.
        const pick = (x, y) => bMain && !aMain ? y || x : aMain && !bMain ? x || y : x || y;
        return {
            ...a,
            condition: bMain && !aMain ? b.condition : a.condition,
            log2RatioPeptide: pick(a.log2RatioPeptide, b.log2RatioPeptide),
            pValuePeptide: pick(a.pValuePeptide, b.pValuePeptide),
            log2RatioProtein: a.log2RatioProtein || b.log2RatioProtein,
            pValueProtein: a.pValueProtein || b.pValueProtein,
        };
    };
    for (const r of rows) {
        const key = keyOf(r);
        const i = indexByKey.get(key);
        if (i !== undefined) {
            kept[i] = merge(kept[i], r);
            continue;
        }
        indexByKey.set(key, kept.length);
        kept.push(r);
    }
    return kept;
}
function csvEscape(v) {
    if (/[",\n\r]/.test(v))
        return `"${v.replace(/"/g, '""')}"`;
    return v;
}
