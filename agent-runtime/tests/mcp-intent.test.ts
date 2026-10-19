import assert from "node:assert/strict";
import {
  MCP_INTENT_TOOLS,
  retrieveIntentTools,
  retrieveIntentToolsDeep,
} from "../src/agent/retriever.js";
import { parseEntities, emptyMemory } from "../src/context/memory.js";
import { buildIntentArgs } from "../src/agent/intent-args.js";

const memory = { gene: "AKT1", position: 473, uniprot_ac: "P31749", ptm_type: "phosphorylation" };

const kinaseQ = "Which kinases phosphorylate AKT1 S473?";
const kinaseQZh = "哪些激酶磷酸化 AKT1 S473？";
const conceptQ = "What is phosphorylation?";

const kinaseTools = retrieveIntentTools(kinaseQ, memory, 4);
assert.ok(kinaseTools.includes("get_upstream_enzymes"), `expected kinase intent, got ${kinaseTools.join(",")}`);
assert.ok(!kinaseTools.includes("qptm_invoke" as never), "legacy invoke must not appear");

const kinaseToolsZh = retrieveIntentTools(kinaseQZh, memory, 4);
assert.ok(
  kinaseToolsZh.includes("get_upstream_enzymes"),
  `expected Chinese kinase intent, got ${kinaseToolsZh.join(",")}`,
);

const conceptTools = retrieveIntentTools(conceptQ, {}, 4);
assert.ok(conceptTools.includes("search_ptm_sites"));
assert.ok(
  !conceptTools.every((t) => t === "get_upstream_enzymes"),
  "concept retriever should not be kinase-only",
);

const phosphoOnly = retrieveIntentTools(
  "HDGF 165 phosphorylation fold change in BRCA",
  { gene: "HDGF", position: 165, uniprot_ac: "P51858", ptm_type: "all" },
  4,
);
assert.ok(phosphoOnly.includes("get_site_conditions"));
assert.equal(phosphoOnly.includes("get_upstream_enzymes"), false);

const deep = retrieveIntentToolsDeep(kinaseQ, memory);
assert.ok(deep.includes("get_upstream_enzymes"));

assert.equal(MCP_INTENT_TOOLS.length, 10);
for (const name of MCP_INTENT_TOOLS) {
  assert.match(name, /^[a-z_]+$/);
}
assert.equal(MCP_INTENT_TOOLS.includes("qptm_invoke" as never), false);

const mem = emptyMemory();
mem.gene = "HDGF";
mem.position = 165;
mem.uniprot_ac = "P51858";
const args = buildIntentArgs(mem, "HDGF S165 in breast cancer", {
  condition_query: "BRCA",
  condition_type: "disease",
  drug: "Gefitinib",
  disease: "breast cancer",
  cancer: "BRCA",
});
assert.equal(args.condition_query, "BRCA");
assert.equal(args.condition_type, "disease");
assert.equal(args.drug, "Gefitinib");
assert.equal(args.disease, "breast cancer");
assert.equal(args.cancer, "BRCA");
assert.equal(args.gene, "HDGF");
assert.equal(args.position, 165);

console.log("mcp-intent tests passed");
