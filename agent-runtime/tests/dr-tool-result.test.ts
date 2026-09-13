import assert from "node:assert/strict";
import {
  gapScore,
  isCallBug,
  isEmptyToolResult,
  mayRecallIntent,
  toStepOutcome,
} from "../src/agent/tool-result.js";
import type { QptmToolResult } from "../src/mcp/hub.js";

assert.equal(isEmptyToolResult({ error_kind: "empty_result" }), true);
assert.equal(isEmptyToolResult({ error_kind: "call_bug" }), false);
assert.equal(isCallBug({ error_kind: "call_bug" }), true);
assert.equal(isCallBug({ error_kind: "empty_result" }), false);

const ok: QptmToolResult = {
  success: true,
  summary: "PSP kinases",
  blocks: [{ evidence_level: "experimental", shown: 3, rows: [{ k: 1 }] }],
};
const empty: QptmToolResult = {
  success: false,
  summary: "no rows",
  error_kind: "empty_result",
};
const bug: QptmToolResult = {
  success: false,
  summary: "timeout",
  error_kind: "call_bug",
};
const predicted: QptmToolResult = {
  success: true,
  summary: "GPS only",
  blocks: [{ evidence_level: "predicted", shown: 5, rows: [{ k: 1 }] }],
};

assert.equal(toStepOutcome("get_upstream_enzymes", ok).success, true);
assert.equal(toStepOutcome("get_upstream_enzymes", empty).empty, true);
assert.equal(toStepOutcome("get_upstream_enzymes", bug).callBug, true);
assert.equal(toStepOutcome("get_upstream_enzymes", predicted).predictedOnly, true);

assert.equal(gapScore([]), 1);
assert.equal(gapScore([toStepOutcome("a", ok), toStepOutcome("b", ok)]), 0);
assert.equal(gapScore([toStepOutcome("a", ok), toStepOutcome("b", empty)]), 0.5);
assert.equal(gapScore([toStepOutcome("a", empty), toStepOutcome("b", empty)]), 1);

const emptySet = new Set(["get_site_conditions"]);
const okSet = new Set(["get_upstream_enzymes"]);
assert.equal(mayRecallIntent("get_site_conditions", emptySet, okSet), false);
assert.equal(mayRecallIntent("get_upstream_enzymes", emptySet, okSet), false);
assert.equal(mayRecallIntent("get_function_disease", emptySet, okSet), true);

console.log("dr-tool-result.test.ts: ok");
