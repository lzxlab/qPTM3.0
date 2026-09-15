/** Read-only extraction of model reasoning already present on API payloads. */
const REASONING_KEYS = ["reasoning_content", "reasoning", "thinking", "reasoning_text"];
function stringField(obj, key) {
    const v = obj[key];
    if (typeof v === "string" && v)
        return v;
    if (v && typeof v === "object" && "content" in v) {
        const inner = v.content;
        if (typeof inner === "string" && inner)
            return inner;
    }
    return "";
}
export function extractReasoning(payload) {
    if (!payload || typeof payload !== "object")
        return "";
    const rec = payload;
    for (const key of REASONING_KEYS) {
        const s = stringField(rec, key);
        if (s)
            return s;
    }
    return "";
}
/** Visible completion is empty unless there is content or tool calls. Reasoning alone is not success. */
export function isEmptyLlmResult(content, toolCalls) {
    return !content && !(Array.isArray(toolCalls) && toolCalls.length > 0);
}
