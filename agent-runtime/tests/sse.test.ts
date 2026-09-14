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

console.log("sse tests passed");
