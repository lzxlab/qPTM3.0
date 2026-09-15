import assert from "node:assert/strict";
import {
  applyAgentEvent,
  appendAnswerText,
  emptyWorkflowState,
  workflowHasData,
} from "../src/agent/workflow-trace.js";
import { flattenPlanIntents } from "../src/agent/dr-research-loop.js";

const state = emptyWorkflowState();
assert.equal(workflowHasData(state), false);

applyAgentEvent(state, {
  type: "route_decision",
  handler: "investigate",
  query_mode: "research",
  specific_enough: true,
  may_clarify: false,
  entities: { gene: "AKT1", position: 473 },
});
assert.equal(state.decision?.handler, "investigate");

applyAgentEvent(state, {
  type: "supervisor_decision",
  round: 0,
  actions: [{ name: "breadth_search" }],
  rationale: "Need a survey first",
  gap_score: 0.4,
  outcomes_summary: "none yet",
});
assert.equal(state.supervisor.length, 1);

applyAgentEvent(state, {
  type: "plan_created",
  plan: {
    intent_summary: "Survey AKT1 S473",
    steps: [{ step: 1, title: "Kinases", tools: ["get_upstream_enzymes"], status: "pending" }],
  },
});
applyAgentEvent(state, { type: "step_started", step: 1, title: "Kinases" });
assert.equal(state.plan.steps[0].status, "running");
applyAgentEvent(state, { type: "step_completed", step: 1, status: "done" });
assert.equal(state.plan.steps[0].status, "done");

applyAgentEvent(state, { type: "text", content: "REPORT BODY" });
applyAgentEvent(state, { type: "report_thought", content: "I will cite kinases first. " });
applyAgentEvent(state, { type: "report_thought", content: "Then conditions." });
assert.equal(state.synthesis.thought.includes("I will cite kinases"), true);
assert.equal(
  state.events.some((e) => String(e.message || "").includes("I will cite kinases")),
  false,
);

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

const tools = flattenPlanIntents(
  [
    { step: 1, title: "A", entity: "kinase", tools: ["get_upstream_enzymes", "get_site_conditions"], rationale: "" },
    { step: 2, title: "B", entity: "disease", tools: ["get_function_disease"], rationale: "" },
  ],
  new Set(),
  new Set(),
);
assert.deepEqual(tools, ["get_upstream_enzymes", "get_site_conditions", "get_function_disease"]);

console.log("workflow-trace tests passed");
