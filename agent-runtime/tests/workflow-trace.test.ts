import assert from "node:assert/strict";
import {
  applyAgentEvent,
  appendAnswerText,
  emptyWorkflowState,
  workflowHasData,
} from "../src/agent/workflow-trace.js";

const state = emptyWorkflowState();
assert.equal(workflowHasData(state), false);
assert.equal("evidence" in state.synthesis, false);

applyAgentEvent(state, { type: "text", content: "REPORT BODY" });
applyAgentEvent(state, { type: "report_thought", content: "I will cite kinases first. " });
applyAgentEvent(state, { type: "report_thought", content: "Then conditions." });
assert.equal(state.synthesis.thought.includes("I will cite kinases"), true);
assert.equal(
  state.events.some((e) => String(e.message || "").includes("I will cite kinases")),
  false,
);

const longThought = "x".repeat(300000);
const capped = emptyWorkflowState();
applyAgentEvent(capped, { type: "report_thought", content: longThought });
assert.equal(capped.synthesis.thought.length, 256 * 1024);

let fullAnswer = "";
fullAnswer = appendAnswerText(fullAnswer, { type: "report_thought", content: "SECRET THINK" });
fullAnswer = appendAnswerText(fullAnswer, { type: "text", content: "Hello report" });
fullAnswer = appendAnswerText(fullAnswer, { type: "reasoning" as string, content: "nope" });
assert.equal(fullAnswer, "Hello report");

const legacy = emptyWorkflowState();
applyAgentEvent(legacy, { type: "phase_update", phase: "database", label: "Querying databases" });
assert.ok(workflowHasData(legacy));
assert.equal(legacy.decision, null);
assert.equal(legacy.supervisor.length, 0);
assert.equal(legacy.synthesis.thought, "");

applyAgentEvent(legacy, {
  type: "synthesis_started",
  evidence: { db_results: 3, db_rows: 12 },
});
assert.equal("evidence" in legacy.synthesis, false);

console.log("workflow-trace tests passed");
