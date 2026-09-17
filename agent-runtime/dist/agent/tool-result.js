export function isEmptyToolResult(result) {
    return result.error_kind === "empty_result";
}
function isCallBug(result) {
    return result.error_kind === "call_bug";
}
function isPredictedOnlyResult(result) {
    const blocks = Array.isArray(result.blocks) ? result.blocks : [];
    const withRows = blocks.filter((b) => {
        const row = b;
        const shown = Number(row.shown || 0);
        const rows = row.rows;
        return shown > 0 || (Array.isArray(rows) && rows.length > 0);
    });
    if (!withRows.length)
        return false;
    return withRows.every((b) => {
        const level = String(b.evidence_level || "").toLowerCase();
        return level === "predicted";
    });
}
export function toStepOutcome(tool, result) {
    const empty = isEmptyToolResult(result);
    const callBug = isCallBug(result);
    const predictedOnly = !empty && !callBug && isPredictedOnlyResult(result);
    return {
        tool,
        success: result.success && !empty && !callBug && !predictedOnly,
        empty,
        callBug,
        predictedOnly,
        error_kind: result.error_kind,
        summary: (result.summary || "").slice(0, 400),
    };
}
