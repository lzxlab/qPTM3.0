import assert from "node:assert/strict";
import { parseToolIndices, retrieveIntentTools } from "../src/agent/retriever.js";
import { parseEntities } from "../src/context/memory.js";

assert.deepEqual(parseToolIndices("TOOLS: []", 10), []);
assert.deepEqual(parseToolIndices("TOOLS: [0, 2, 5]", 10), [0, 2, 5]);
assert.deepEqual(parseToolIndices("here you go\nTOOLS: [1, 1, 3]\n", 5), [1, 3]);
assert.equal(parseToolIndices("no indices here", 10), null);
assert.equal(parseToolIndices("TOOLS: [99]", 3), null);

const memory = { gene: "AKT1", position: 473, uniprot_ac: "P31749", ptm_type: "phosphorylation" };
const kinaseTools = retrieveIntentTools("Which kinases phosphorylate AKT1 S473?", memory, 6);
assert.ok(kinaseTools.includes("get_upstream_enzymes"));

const phosphoOnly = retrieveIntentTools(
  "HDGF 165 phosphorylation fold change in BRCA",
  { gene: "HDGF", position: 165, uniprot_ac: "P51858", ptm_type: "all" },
  6,
);
assert.ok(phosphoOnly.includes("get_site_conditions"));
assert.equal(phosphoOnly.includes("get_upstream_enzymes"), false);

const cancerQ = retrieveIntentTools(
  "MYH9 1445 tumor vs normal",
  { gene: "MYH9", position: 1445, uniprot_ac: "P35579", ptm_type: "all" },
  6,
);
assert.ok(cancerQ.includes("get_site_conditions"));

const sumoQ = retrieveIntentTools("SUMO sites on TP53", { gene: "TP53" }, 6);
assert.ok(sumoQ.includes("get_upstream_enzymes"));

const signalQ = retrieveIntentTools("signal peptide of EGFR", { gene: "EGFR" }, 6);
assert.ok(signalQ.includes("get_localization"));

const breast = parseEntities("breast cancer PTM changes");
assert.notEqual(breast.gene, "CANCER");

const hdgf = parseEntities("HDGF 165 BRCA");
assert.equal(hdgf.gene, "HDGF");
assert.equal(hdgf.position, 165);

const greetingFallback = retrieveIntentTools("hello", parseEntities("hello"), 4);
assert.ok(Array.isArray(greetingFallback));

console.log("retriever tests passed");
