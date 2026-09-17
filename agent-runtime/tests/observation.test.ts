import assert from "node:assert/strict";
import { compactDbPayload } from "../src/context/artifacts.js";
import {
  emptyCallKey,
  followableEntitiesFromPayload,
  formatToolObservation,
} from "../src/agent/observation.js";

const emptyKey = emptyCallKey("get_upstream_enzymes", { query: "AKT1 S473", gene: "AKT1", position: 473 });
assert.equal(
  emptyCallKey("get_upstream_enzymes", { query: "AKT1 S473", gene: "AKT1", position: 473 }),
  emptyKey,
);
assert.notEqual(
  emptyCallKey("get_upstream_enzymes", { query: "AKT1 S473", gene: "AKT1", position: 473, limit: 50 }),
  emptyKey,
);

const payload = compactDbPayload({
  intent: "get_upstream_enzymes",
  blocks: [
    {
      source_name: "qPTM",
      evidence_level: "experimental",
      shown: 2,
      total: 40,
      truncated: true,
      rows: [{ kinase_gene: "MTOR" }, { kinase_gene: "PDK1" }],
    },
  ],
});
const entities = followableEntitiesFromPayload(payload, ["AKT1"]);
assert.ok(entities.includes("MTOR"));
assert.ok(entities.includes("PDK1"));

const obs = formatToolObservation(
  "get_upstream_enzymes",
  { success: true, summary: "2 kinases", data: null, error_kind: null },
  payload,
);
assert.match(obs, /truncated/);
assert.match(obs, /shown=2/);
assert.match(obs, /Followable entities: MTOR/);

const emptyObs = formatToolObservation("search_ptm_sites", {
  success: false,
  summary: "no rows",
  data: null,
  error_kind: "empty_result",
});
assert.match(emptyObs, /\[empty_result\]/);

console.log("observation tests passed");
