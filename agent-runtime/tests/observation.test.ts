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

const brca = compactDbPayload({
  intent: "get_site_conditions",
  blocks: [
    {
      tool: "qptm_site_conditions",
      source_name: "qPTM",
      evidence_level: "experimental",
      shown: 1,
      total: 1,
      truncated: false,
      rows: [
        {
          condition_name: "BRCA PT (133)/Normal (18)",
          contrast_type: "disease",
          event_count: 2,
          log2_range: { avg: 2.64, min: 2.64, max: 2.64 },
        },
      ],
    },
  ],
});
assert.equal(brca?.blocks[0].rows[0].log2_avg, 2.64);
assert.equal(brca?.blocks[0].rows[0].condition_name, "BRCA PT (133)/Normal (18)");

const brcaObs = formatToolObservation(
  "get_site_conditions",
  {
    success: true,
    summary: "qPTM: 1 disease-type condition(s) matching 'BRCA'. 1 condition(s) show |log2| > 1.",
    data: null,
    error_kind: null,
  },
  brca,
);
assert.match(brcaObs, /2\.64/);
assert.match(brcaObs, /BRCA PT/);
assert.match(brcaObs, /log2_avg=2\.64/);

const crowded = compactDbPayload({
  intent: "get_site_conditions",
  blocks: [
    {
      source_name: "CancerProteome",
      shown: 1,
      total: 1,
      truncated: false,
      rows: [
        {
          extra1: "a",
          extra2: "b",
          extra3: "c",
          extra4: "d",
          extra5: "e",
          extra6: "f",
          extra7: "g",
          extra8: "h",
          extra9: "i",
          qratio: 0.553,
          cancer: "BRCA",
        },
      ],
    },
  ],
});
assert.equal(crowded?.blocks[0].rows[0].qratio, 0.553);

console.log("observation tests passed");
