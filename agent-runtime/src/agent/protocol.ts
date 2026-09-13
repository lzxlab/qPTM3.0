/** Tokens that must never appear in user-visible assistant text. */
export const PROTOCOL_LEAK_RE =
  /<[|｜]+DSML[|｜]+|<\/?tool_call\b|tool_calls|function_call|<tool\b|<\/tool>/i;

const TOOL_CALL_BLOCK_RE = /<\/?tool_call\b[^>]*>[\s\S]*?(<\/tool_call>|$)/gi;
const TOOL_CALLS_JSON_RE = /```(?:json|xml|text)?\s*\{[\s\S]*?"tool_calls"[\s\S]*?```/gi;
const TOOL_CALLS_INLINE_RE = /"?tool_calls"?\s*[:=]\s*\[[\s\S]*?\]/gi;
const FUNCTION_CALL_RE = /"?function_call"?\s*[:=]\s*\{[\s\S]*?\}/gi;
const ANGLE_PROTOCOL_RE = /<\|[^|]{0,120}\|>/g;
const DSML_BLOCK_RE = /<\|DSML\|[^>]*>[\s\S]*?<\/\|DSML\|[^>]*>/gi;
const DSML_TAG_RE = /<\/?\|DSML\|[^>]*>/gi;

/** Normalize fullwidth pipes and repeated delimiters from some model outputs. */
export function normalizeProtocolText(text: string): string {
  return text.replace(/\uFF5C/g, "|").replace(/\|{2,}/g, "|");
}

export function containsProtocolMarkup(text: string): boolean {
  return Boolean(text && PROTOCOL_LEAK_RE.test(normalizeProtocolText(text)));
}

function stripDsmlBlocks(text: string): string {
  let s = text;
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(DSML_BLOCK_RE, "");
  }
  return s.replace(DSML_TAG_RE, "");
}

export function stripProtocolMarkup(text: string): { text: string; leaked: boolean } {
  if (!text) return { text: "", leaked: false };
  const leaked = containsProtocolMarkup(text);
  let s = normalizeProtocolText(text);
  s = stripDsmlBlocks(s);
  s = s.replace(TOOL_CALL_BLOCK_RE, "");
  s = s.replace(TOOL_CALLS_JSON_RE, "");
  s = s.replace(TOOL_CALLS_INLINE_RE, "");
  s = s.replace(FUNCTION_CALL_RE, "");
  s = s.replace(ANGLE_PROTOCOL_RE, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return { text: s, leaked };
}

export function failedGenerationMessage(lang: "zh" | "en" = "en"): string {
  return lang === "zh" ? "生成失败，请重试。" : "Generation failed. Please retry.";
}

function isSubstantiveAnswer(text: string): boolean {
  const stripped = text
    .replace(/\*\*(?:Resolved|已解析靶点)[：:]\*\*[^\n]*\n*/gi, "")
    .replace(/^Resolved:\s*[^\n]+\n*/im, "")
    .replace(/\s/g, "");
  return stripped.length >= 24;
}

/** If stripping leaves nothing readable, replace with a retry prompt. */
export function sanitizeUserVisibleText(text: string, lang: "zh" | "en" = "en"): string {
  const { text: cleaned, leaked } = stripProtocolMarkup(text);
  if (leaked && !isSubstantiveAnswer(cleaned)) {
    return failedGenerationMessage(lang);
  }
  return cleaned;
}
