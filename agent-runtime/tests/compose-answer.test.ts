import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../src/context/artifacts.js";
import { emptyMemory } from "../src/context/memory.js";
import { cluesForComposer, composeSystemPrompt } from "../src/agent/compose-answer.js";
import { loadSkills, skillsForMode } from "../src/skills/loader.js";

const here = dirname(fileURLToPath(import.meta.url));

const memory = emptyMemory();
memory.gene = "EGFR";
memory.position = 1068;

const store = new ArtifactStore();
store.add("db_result", "search_ptm_sites", "[empty_result] no rows", {
  tool: "search_ptm_sites",
  payload: { intent: "search_ptm_sites", blocks: [] },
});
store.add("db_result", "get_upstream_enzymes", "4414 kinase rows", {
  tool: "get_upstream_enzymes",
  payload: {
    intent: "get_upstream_enzymes",
    blocks: [
      {
        tool: "get_upstream_enzymes",
        source: "PhosphoSitePlus",
        evidence_level: "experimental",
        total: 4414,
        shown: 4414,
        truncated: false,
        rows: Array.from({ length: 40 }, (_, i) => ({
          kinase_gene: `KIN${i}`,
          pmid: `${10000000 + i}`,
        })),
      },
    ],
  },
});
store.add("paper", "EGFR Y1068 SRC", "SRC phosphorylates EGFR Y1068 during EGF signaling", {
  pmids: ["12345678"],
});
store.add("web_search", "EGFR Y1068", "news snippet about a kinase assay");

const clues = cluesForComposer(memory, store);
assert.match(clues, /These are clues/);
assert.match(clues, /gene=EGFR/);
assert.match(clues, /PhosphoSitePlus/);
assert.match(clues, /PMID:12345678/);
assert.match(clues, /news snippet about a kinase assay/);
assert.equal(clues.includes("search_ptm_sites"), false);
assert.equal(clues.includes("get_upstream_enzymes"), false);
assert.equal(clues.includes("[empty_result]"), false);
assert.equal(clues.includes("secondary, low weight"), false);
assert.equal(clues.includes("database facts > literature"), false);
assert.ok(clues.length <= 5500);
assert.equal((clues.match(/KIN\d+/g) || []).length, 6);

const huge = new ArtifactStore();
huge.add("db_result", "get_site_conditions", "many conditions", {
  tool: "get_site_conditions",
  payload: {
    intent: "get_site_conditions",
    blocks: [
      {
        source: "qPTM",
        evidence_level: "experimental",
        total: 9000,
        shown: 9000,
        truncated: false,
        rows: Array.from({ length: 200 }, (_, i) => ({
          condition: `cond${i}`,
          log2fc: i,
          pmid: `${20000000 + i}`,
          extra: "x".repeat(80),
        })),
      },
    ],
  },
});
const packed = cluesForComposer(memory, huge);
assert.ok(packed.length <= 5500, `clue pack too large: ${packed.length}`);
assert.ok(!packed.includes("### get_site_conditions"));

const prompt = composeSystemPrompt("S1: qPTM");
assert.match(prompt, /Build the answer skeleton from the question/);
assert.match(prompt, /Never write MCP or internal tool names/);
assert.match(prompt, /search_ptm_sites/);
assert.match(prompt, /Lead with the conclusion/);
assert.match(prompt, /Mention a gap only in one closing sentence/);
assert.match(prompt, /ANSWER_LANGUAGE_RULE|Write the user-visible answer in Chinese only if/);
assert.equal(prompt.includes("Write a sectioned, well-cited report"), false);
assert.equal(prompt.includes("state gaps honestly"), false);

assert.deepEqual(skillsForMode("compose", "EGFR Y1068 kinase"), ["answer-ptm"]);
const composeSkills = loadSkills(skillsForMode("compose", "EGFR Y1068"));
assert.match(composeSkills, /Skill: answer-ptm/);
assert.match(composeSkills, /Skeleton then muscle/);
assert.equal(composeSkills.includes("Skill: deep-research-ptm"), false);
assert.equal(composeSkills.includes("Supervisor (outer ReAct)"), false);
assert.equal(composeSkills.includes("breadth_search"), false);

const reactSkills = loadSkills(skillsForMode("react", "EGFR Y1068 kinase"));
assert.match(reactSkills, /ptm-databases/);
assert.match(reactSkills, /NOT an answer outline/);

const runSrc = readFileSync(join(here, "../src/agent/run.ts"), "utf8");
assert.match(runSrc, /composeAnswer/);
assert.equal(runSrc.includes("hasSubstantialEvidence"), false);
assert.equal(runSrc.includes("streamDeepReport"), false);
assert.equal(runSrc.includes("loadSkills("), false);
assert.equal(runSrc.includes("catalogForPrompt"), false);
assert.equal(runSrc.includes("rowsForPrompt"), false);

const composeSrc = readFileSync(join(here, "../src/agent/compose-answer.ts"), "utf8");
assert.match(composeSrc, /skillsForMode\("compose"/);
assert.equal(composeSrc.includes("deep-research-ptm"), false);
assert.equal(composeSrc.includes("rowsForPrompt(12000)"), false);
assert.equal(composeSrc.includes("getLiteratureContext"), false);

const drSrc = readFileSync(join(here, "../src/agent/deep-research.ts"), "utf8");
assert.match(drSrc, /composeAnswer/);
assert.equal(drSrc.includes("Write a sectioned, well-cited report"), false);
assert.equal(drSrc.includes("rowsForPrompt(12000)"), false);

console.log("compose-answer tests passed");
