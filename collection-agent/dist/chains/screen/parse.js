export class ScreenParseError extends Error {
    raw;
    constructor(message, raw) {
        super(message);
        this.raw = raw;
        this.name = "ScreenParseError";
    }
}
const DECISIONS = new Set(["include", "exclude", "uncertain"]);
const DATA_HINTS = new Set(["supplementary", "proteomexchange", "main_text", "unknown"]);
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
    throw new ScreenParseError("Failed to parse JSON object from LLM output", text);
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.map((x) => String(x)).filter(Boolean);
}
export function parseScreenOutput(raw, meta) {
    const obj = extractJsonObject(raw);
    let decision = String(obj.decision ?? "").toLowerCase();
    if (!DECISIONS.has(decision)) {
        throw new ScreenParseError(`Invalid decision: ${obj.decision}`, raw);
    }
    let confidence = Number(obj.confidence);
    if (!Number.isFinite(confidence))
        confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    // Align with L2M3-style conservative gating
    if (confidence < 0.7 && decision !== "uncertain") {
        decision = "uncertain";
    }
    const dataSourceHint = String(obj.dataSourceHint ?? "unknown");
    if (!DATA_HINTS.has(dataSourceHint)) {
        throw new ScreenParseError(`Invalid dataSourceHint: ${obj.dataSourceHint}`, raw);
    }
    return {
        pmid: meta.pmid,
        title: meta.title,
        decision,
        confidence,
        ptmTypes: asStringArray(obj.ptmTypes),
        organisms: asStringArray(obj.organisms),
        isQuantitativeMs: Boolean(obj.isQuantitativeMs),
        hasSiteLevelDataHint: Boolean(obj.hasSiteLevelDataHint),
        quantificationMethods: asStringArray(obj.quantificationMethods),
        dataSourceHint: dataSourceHint,
        reason: String(obj.reason ?? "").trim() || "No reason provided",
        sourceFile: meta.sourceFile,
        screenedAt: new Date().toISOString(),
    };
}
