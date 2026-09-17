import type { QptmToolResult } from "../mcp/hub.js";

export type StepOutcome = {
  tool: string;
  success: boolean;
  empty: boolean;
  callBug: boolean;
  predictedOnly: boolean;
  error_kind?: string | null;
  summary: string;
};

export function isEmptyToolResult(result: {
  success?: boolean;
  error_kind?: string | null;
}): boolean {
  return result.error_kind === "empty_result";
}

function isCallBug(result: { error_kind?: string | null }): boolean {
  return result.error_kind === "call_bug";
}

function isPredictedOnlyResult(result: QptmToolResult): boolean {
  const blocks = Array.isArray(result.blocks) ? result.blocks : [];
  const withRows = blocks.filter((b) => {
    const row = b as Record<string, unknown>;
    const shown = Number(row.shown || 0);
    const rows = row.rows;
    return shown > 0 || (Array.isArray(rows) && rows.length > 0);
  });
  if (!withRows.length) return false;
  return withRows.every((b) => {
    const level = String((b as Record<string, unknown>).evidence_level || "").toLowerCase();
    return level === "predicted";
  });
}

export function toStepOutcome(tool: string, result: QptmToolResult): StepOutcome {
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
