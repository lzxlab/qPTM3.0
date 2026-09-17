import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/agent/run.ts"), "utf8");
assert.match(src, /runReactLoop/);
assert.match(src, /isCollectionRequest/);
assert.equal(src.includes("composeAnswer"), false);
assert.equal(src.includes("hasSubstantialEvidence"), false);
assert.equal(src.includes("streamDeepReport"), false);
assert.equal(src.includes("routeQuery"), false);
assert.equal(src.includes("runQA"), false);
assert.equal(src.includes("runDeepResearch"), false);
assert.equal(src.includes("runSupervisorLoop"), false);
assert.equal(src.includes("buildDeepResearchClarification"), false);
assert.equal(src.includes("classifyQueryMode"), false);
assert.equal(src.includes("clarificationResponse"), false);
assert.equal(src.includes("cluesForComposer"), false);

const react = readFileSync(join(here, "../src/agent/react-loop.ts"), "utf8");
assert.match(react, /retrieveIntentToolsLlm/);
assert.match(react, /callSearchLiteratureDeep/);
assert.match(react, /web_search/);
assert.match(react, /maxTokens:\s*8192/);
assert.match(react, /tools:\s*\[\]/);
assert.match(react, /Do not call tools\. Write the user-visible answer now/);
assert.equal(react.includes("breadth_search"), false);
assert.equal(react.includes("depth_search"), false);
assert.equal(react.includes("finish_research"), false);
assert.equal(react.includes("runSupervisorLoop"), false);
assert.equal(react.includes("cluesForComposer"), false);
assert.equal(react.includes("composeAnswer"), false);
assert.equal(cfg.reactMaxRounds, 8);

const yieldTextAt = react.indexOf('yield { type: "text"');
const callsBlock = react.indexOf("if (calls.length)");
assert.ok(callsBlock >= 0);
assert.ok(yieldTextAt > callsBlock, "text must be yielded only after the tool_calls branch");
assert.match(react, /if \(calls\.length\) \{[\s\S]*continue;[\s\S]*answer = visibleAnswer/);

const gone = [
  "qa-react.ts",
  "router.ts",
  "deep-research.ts",
  "clarification.ts",
  "resolve-target.ts",
  "dr-research-loop.ts",
  "compose-answer.ts",
  "gate.ts",
];
for (const file of gone) {
  assert.equal(existsSync(join(here, "../src/agent", file)), false, file);
}

console.log("react-entry tests passed");
