/** Read-only extraction of model reasoning already present on API payloads. */

const REASONING_KEYS = ["reasoning_content", "reasoning", "thinking", "reasoning_text"] as const;

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object" && "content" in (v as object)) {
    const inner = (v as { content?: unknown }).content;
    if (typeof inner === "string" && inner) return inner;
  }
  return "";
}

export function extractReasoning(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const rec = payload as Record<string, unknown>;
  for (const key of REASONING_KEYS) {
    const s = stringField(rec, key);
    if (s) return s;
  }
  return "";
}

/** Visible completion is empty unless there is content or tool calls. Reasoning alone is not success. */
export function isEmptyLlmResult(content: string, toolCalls: unknown[]): boolean {
  return !content && !(Array.isArray(toolCalls) && toolCalls.length > 0);
}
