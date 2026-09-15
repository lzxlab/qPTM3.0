import assert from "node:assert/strict";
import { agentEventToSse } from "../src/sse.js";

const withDetail = agentEventToSse({
  type: "phase_update",
  phase: "supervising",
  label: "Evaluating evidence, choosing next step",
  detail: "Need kinases next",
});
assert.ok(withDetail);
assert.match(withDetail, /^event: phase_update\n/);
assert.match(withDetail, /"phase":"supervising"/);
assert.match(withDetail, /"label":"Evaluating evidence, choosing next step"/);
assert.match(withDetail, /"detail":"Need kinases next"/);

const withoutDetail = agentEventToSse({
  type: "phase_update",
  phase: "supervising",
  label: "Evaluating evidence, choosing next step",
});
assert.ok(withoutDetail);
assert.match(withoutDetail, /"phase":"supervising"/);
assert.equal(withoutDetail.includes("detail"), false);

const emptyDetail = agentEventToSse({
  type: "phase_update",
  phase: "supervising",
  label: "Evaluating evidence, choosing next step",
  detail: "   ",
});
assert.ok(emptyDetail);
assert.equal(emptyDetail.includes("detail"), false);

assert.equal(agentEventToSse({ type: "_internal" }), null);
assert.equal(agentEventToSse({ type: "unknown_event" }), null);

const route = agentEventToSse({
  type: "route_decision",
  handler: "investigate",
  query_mode: "research",
  specific_enough: true,
  may_clarify: false,
  entities: { gene: "AKT1" },
});
assert.ok(route);
assert.match(route, /^event: route_decision\n/);
assert.match(route, /"handler":"investigate"/);

const thought = agentEventToSse({ type: "report_thought", content: "organize by kinase" });
assert.ok(thought);
assert.match(thought, /^event: report_thought\n/);
assert.match(thought, /"content":"organize by kinase"/);
assert.equal(thought.includes("event: text"), false);

const step = agentEventToSse({ type: "step_started", step: 1, title: "Kinases" });
assert.ok(step);
assert.match(step, /^event: step_started\n/);

console.log("sse tests passed");
