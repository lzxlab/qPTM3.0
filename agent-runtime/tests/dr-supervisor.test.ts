import assert from "node:assert/strict";
import { AgentPhase } from "../src/agent/phase.js";
import {
  SUPERVISOR_META_TOOLS,
  buildDepthQuery,
  buildIntentArgs,
  createDrState,
  flattenPlanIntents,
  intentForFocus,
  planLiteratureFocuses,
  seedDrStateFromArtifacts,
  shouldAcceptFinish,
  DEFAULT_INTENT_LIMIT,
  MAX_INTENT_LIMIT,
} from "../src/agent/dr-research-loop.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore, compactDbPayload } from "../src/context/artifacts.js";
import { cfg } from "../src/config.js";

assert.equal(cfg.drSupervisorMaxRounds, 6);
assert.ok(AgentPhase.supervising);
assert.ok(AgentPhase.breadth);
assert.ok(AgentPhase.depth);

const meta = new Set(SUPERVISOR_META_TOOLS);
assert.ok(meta.has("breadth_search"));
assert.ok(meta.has("depth_search"));
assert.ok(meta.has("web_search"));
assert.ok(meta.has("finish_research"));
assert.equal(meta.size, 4);

const memory = {
  gene: "AKT1",
  position: 473,
  uniprot_ac: "P31749",
  ptm_type: "phosphorylation",
  organism: "human",
  findings_summary: "",
  query_mode: "deep_research",
};

const kinaseQ = buildDepthQuery("kinase", memory, "Which kinases?");
assert.match(kinaseQ, /AKT1/);
assert.match(kinaseQ, /kinase/i);

const condQ = buildDepthQuery("condition", memory, "fold change?");
assert.match(condQ, /treatment/i);

const generic = buildDepthQuery("custom mechanism", memory, "fallback question");
assert.ok(generic.length > 0);

const mem = {
  gene: "AKT1",
  position: 473,
  uniprot_ac: "P31749",
  ptm_type: "phosphorylation",
  organism: "human",
  findings_summary: "",
  query_mode: "deep_research",
  pmid: null,
  mutation_label: null,
  entities: {},
};

const listed = buildIntentArgs(mem, "把上次 qPTM 返回的全部结果列出来", { limit: 200, sources: "qptm" });
assert.equal(listed.limit, 200);
assert.equal(listed.sources, "qptm");
assert.equal(listed.gene, "AKT1");
assert.equal(listed.position, 473);
assert.equal(listed.uniprot_ac, "P31749");
assert.match(String(listed.query), /全部|qPTM/i);

const defaults = buildIntentArgs(mem, "哪些激酶磷酸化 AKT1 S473？");
assert.equal(defaults.limit, DEFAULT_INTENT_LIMIT);
assert.equal(buildIntentArgs(mem, "x", { limit: 999 }).limit, MAX_INTENT_LIMIT);
assert.equal(shouldAcceptFinish(createDrState()), true);

const store = new ArtifactStore();
const payload = compactDbPayload({
  intent: "get_upstream_enzymes",
  blocks: [
    {
      tool: "qptm_kinases",
      source_name: "qPTM",
      evidence_level: "mixed",
      total: 99,
      shown: 15,
      truncated: true,
      rows: [{ kinase_gene: "TBK1", evidence_type: "experimental" }],
    },
  ],
});
store.add("db_result", "get_upstream_enzymes", "Found 99 kinase(s)", {
  tool: "get_upstream_enzymes",
  payload,
});
const seeded = seedDrStateFromArtifacts(store);
assert.equal(seeded.succeededTools.has("get_upstream_enzymes"), true);
assert.equal(shouldAcceptFinish(seeded, store), true);
assert.match(store.rowsForPrompt(), /TBK1/);
assert.match(store.priorEvidenceForSupervisor(), /truncated 15\/99/);

assert.equal(new ArtifactStore().getWebSearchContext(), "");
store.add("web_search", "AKT1 S473 kinase mechanism", `${"web-hit ".repeat(400)}`);
const webCtx = store.getWebSearchContext();
assert.match(webCtx, /secondary, low weight/);
assert.match(webCtx, /AKT1 S473 kinase mechanism/);
assert.ok(webCtx.length <= 2500);
assert.equal(store.getWebSearchContext(80).length, 80);

const here = dirname(fileURLToPath(import.meta.url));
const drSrc = readFileSync(join(here, "../src/agent/deep-research.ts"), "utf8");
assert.match(drSrc, /getWebSearchContext/);
assert.match(drSrc, /database facts > literature > web/);
assert.match(drSrc, /rowsForPrompt\(12000\),\s*\n\s*artifacts\.getLiteratureContext\(\),\s*\n\s*artifacts\.getWebSearchContext\(\)/);

assert.equal(intentForFocus("kinase"), "get_upstream_enzymes");
assert.equal(intentForFocus("condition"), "get_site_conditions");
assert.equal(intentForFocus("llps"), "get_llps");
assert.equal(intentForFocus("mystery"), undefined);

const flat = flattenPlanIntents(
  [
    { step: 1, title: "k", entity: "kinase", tools: ["get_upstream_enzymes"], rationale: "" },
    { step: 2, title: "c", entity: "condition", tools: ["get_site_conditions", "get_upstream_enzymes"], rationale: "" },
  ],
  new Set(),
  new Set(),
);
assert.deepEqual(flat, ["get_upstream_enzymes", "get_site_conditions"]);
assert.deepEqual(flattenPlanIntents(
  [{ step: 1, title: "k", entity: "kinase", tools: ["get_upstream_enzymes"], rationale: "" }],
  new Set(),
  new Set(["get_upstream_enzymes"]),
), []);
assert.deepEqual(planLiteratureFocuses([
  { step: 1, title: "s", entity: "site", tools: ["search_ptm_sites"], rationale: "" },
  { step: 2, title: "k", entity: "kinase", tools: ["get_upstream_enzymes"], rationale: "" },
]), ["kinase"]);

assert.deepEqual(store.frontierEntities(8, ["AKT1"]), ["TBK1"]);
const withEnt = buildDepthQuery("kinase", memory, "Which kinases?", ["TBK1"]);
assert.match(withEnt, /TBK1/);
assert.match(withEnt, /kinase/i);

const loopSrc = readFileSync(join(here, "../src/agent/dr-research-loop.ts"), "utf8");
const breadthChunk = loopSrc.slice(
  loopSrc.indexOf("export async function* runBreadthPlanExecute"),
  loopSrc.indexOf("export function buildDepthQuery"),
);
assert.equal(breadthChunk.includes("fulltext_pmids"), false);
assert.match(breadthChunk, /flattenPlanIntents/);
assert.match(breadthChunk, /litBreadthLimit/);
assert.match(loopSrc, /litDepthRounds/);
assert.match(loopSrc, /Prefer a direct MCP intent/);
assert.match(loopSrc, /BFS for multi-dimension/);
assert.match(loopSrc, /DFS for ONE known gap/);

console.log("dr-supervisor.test.ts: ok");
