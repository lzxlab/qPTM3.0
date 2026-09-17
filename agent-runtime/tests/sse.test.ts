import assert from "node:assert/strict";
import { agentEventToSse } from "../src/sse.js";

const withDetail = agentEventToSse({
  type: "phase_update",
  phase: "database",
  label: "Querying evidence",
  detail: "Need kinases next",
});
assert.ok(withDetail);
assert.match(withDetail, /^event: phase_update\n/);
assert.match(withDetail, /"phase":"database"/);
assert.match(withDetail, /"label":"Querying evidence"/);
assert.match(withDetail, /"detail":"Need kinases next"/);

const withoutDetail = agentEventToSse({
  type: "phase_update",
  phase: "database",
  label: "Querying evidence",
});
assert.ok(withoutDetail);
assert.match(withoutDetail, /"phase":"database"/);
assert.equal(withoutDetail.includes("detail"), false);

const emptyDetail = agentEventToSse({
  type: "phase_update",
  phase: "database",
  label: "Querying evidence",
  detail: "   ",
});
assert.ok(emptyDetail);
assert.equal(emptyDetail.includes("detail"), false);

assert.equal(agentEventToSse({ type: "_internal" }), null);
assert.equal(agentEventToSse({ type: "unknown_event" }), null);
assert.equal(agentEventToSse({ type: "route_decision" }), null);
assert.equal(agentEventToSse({ type: "synthesis_started" }), null);

const thought = agentEventToSse({ type: "report_thought", content: "organize by kinase" });
assert.ok(thought);
assert.match(thought, /^event: report_thought\n/);
assert.match(thought, /"content":"organize by kinase"/);
assert.equal(thought.includes("event: text"), false);

console.log("sse tests passed");
