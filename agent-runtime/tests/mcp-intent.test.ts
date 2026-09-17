import assert from "node:assert/strict";
import {
  MCP_INTENT_TOOLS,
  retrieveIntentTools,
  retrieveIntentToolsDeep,
} from "../src/agent/retriever.js";
import { parseEntities } from "../src/context/memory.js";

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

const deep = retrieveIntentToolsDeep(kinaseQ, memory);
assert.ok(deep.includes("get_upstream_enzymes"));

assert.equal(MCP_INTENT_TOOLS.length, 10);
for (const name of MCP_INTENT_TOOLS) {
  assert.match(name, /^[a-z_]+$/);
}
assert.equal(MCP_INTENT_TOOLS.includes("qptm_invoke" as never), false);

console.log("mcp-intent tests passed");
