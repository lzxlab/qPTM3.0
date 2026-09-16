import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "../src/config.js";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/agent/run.ts"), "utf8");
assert.match(src, /runReactLoop/);
assert.match(src, /isCollectionRequest/);
assert.match(src, /composeAnswer/);
assert.equal(src.includes("hasSubstantialEvidence"), false);
assert.equal(src.includes("streamDeepReport"), false);
assert.equal(src.includes("routeQuery"), false);
assert.equal(src.includes("runQA"), false);
assert.equal(src.includes("runDeepResearch"), false);
assert.equal(src.includes("runSupervisorLoop"), false);
assert.equal(src.includes("buildDeepResearchClarification"), false);
assert.equal(src.includes("classifyQueryMode"), false);

const react = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/agent/react-loop.ts"), "utf8");
assert.match(react, /retrieveIntentToolsLlm/);
assert.match(react, /callSearchLiteratureDeep/);
assert.match(react, /web_search/);
assert.equal(react.includes("breadth_search"), false);
assert.equal(react.includes("depth_search"), false);
assert.equal(react.includes("finish_research"), false);
assert.equal(react.includes("runSupervisorLoop"), false);
assert.equal(cfg.reactMaxRounds, 8);

console.log("react-entry tests passed");
