import { stripIntensityRatioColumns, } from "../../stage5/heuristic.js";
export class QratioMapParseError extends Error {
    raw;
    constructor(message, raw) {
        super(message);
        this.raw = raw;
        this.name = "QratioMapParseError";
    }
}
function extractJsonObject(text) {
    const cleaned = text
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
        // fall through
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(cleaned.slice(start, end + 1));
        }
        catch {
            // fall through
        }
    }
    throw new QratioMapParseError("Failed to parse JSON object from LLM output", text);
}
function asStr(v) {
    if (v == null)
        return null;
    const s = String(v).trim();
    return s || null;
}
function asNum(v, fallback) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
}
function asValueType(v, isLog2) {
    const s = String(v ?? "").toLowerCase();
    if (s === "intensity")
        return "intensity";
    if (s === "log2_ratio")
        return "log2_ratio";
    if (s === "fold_change")
        return "fold_change";
    if (s === "other")
        return "other";
    return isLog2 ? "log2_ratio" : "fold_change";
}
function parseRatioCols(v) {
    if (!Array.isArray(v))
        return [];
    const out = [];
    for (const item of v) {
        if (!item || typeof item !== "object")
            continue;
        const o = item;
        const column = asStr(o.column);
        if (!column)
            continue;
        const level = o.level === "protein" ? "protein" : "peptide";
        const isLog2 = Boolean(o.isLog2);
        const valueType = asValueType(o.valueType, isLog2);
        if (valueType === "intensity")
            continue; // never treat intensity as ratio
        out.push({
            column,
            condition: asStr(o.condition) || column,
            isLog2: valueType === "log2_ratio" ? true : isLog2,
            level,
            valueType,
        });
    }
    return out;
}
function parsePCols(v) {
    if (!Array.isArray(v))
        return [];
    const out = [];
    for (const item of v) {
        if (!item || typeof item !== "object")
            continue;
        const o = item;
        const column = asStr(o.column);
        if (!column)
            continue;
        const level = o.level === "protein" ? "protein" : "peptide";
        out.push({
            column,
            condition: asStr(o.condition) || "",
            level,
        });
    }
    return out;
}
function parseStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
}
export function parseQratioMapOutput(raw, meta) {
    const obj = extractJsonObject(raw);
    if (!obj || typeof obj !== "object") {
        throw new QratioMapParseError("LLM JSON is not an object", raw);
    }
    const o = obj;
    const skip = Boolean(o.skip);
    const intensityOnly = Boolean(o.intensityOnly);
    const confidence = Math.max(0, Math.min(1, asNum(o.confidence, 0)));
    const intensityColumns = parseStringArray(o.intensityColumns);
    const ratioColumns = parseRatioCols(o.ratioColumns);
    const mapped = {
        entryPath: meta.entryPath,
        sheetName: meta.sheetName,
        headerRowIndex: meta.headerRowIndex ?? 0,
        confidence,
        source: "llm",
        uniprotCol: asStr(o.uniprotCol),
        geneCol: asStr(o.geneCol) || asStr(o.geneNameCol),
        positionCol: asStr(o.positionCol),
        aminoAcidCol: asStr(o.aminoAcidCol),
        siteCombinedCol: asStr(o.siteCombinedCol),
        conditionCol: asStr(o.conditionCol),
        modSeqCol: asStr(o.modSeqCol) || asStr(o.modSequenceCol),
        ratioColumns,
        pValueColumns: parsePCols(o.pValueColumns),
        intensityOnly: intensityOnly || (ratioColumns.length === 0 && intensityColumns.length > 0),
        intensityColumns,
        notes: asStr(o.reason) || "",
        skip: skip || intensityOnly,
    };
    const cleaned = stripIntensityRatioColumns(mapped);
    return {
        ...cleaned,
        skip: Boolean(mapped.skip || cleaned.intensityOnly),
    };
}
