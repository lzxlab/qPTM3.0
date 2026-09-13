import assert from "node:assert/strict";
import { AgentPhase } from "../src/agent/phase.js";
import { SUPERVISOR_META_TOOLS, buildDepthQuery } from "../src/agent/dr-research-loop.js";
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

console.log("dr-supervisor.test.ts: ok");
