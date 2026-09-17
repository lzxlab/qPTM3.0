import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills } from "../src/skills/loader.js";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "../../skills");
const names = readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, "SKILL.md"))).sort();
assert.deepEqual(names, ["biology-qa", "ptm-databases"]);

const gone = [
  "deep-research-ptm",
  "answer-ptm",
  "kinase-substrate",
  "quantitative-dynamics",
  "function-disease",
];
for (const name of gone) {
  assert.equal(existsSync(join(skillsDir, name)), false, name);
}

const packed = loadSkills();
assert.match(packed, /Skill: biology-qa/);
assert.match(packed, /Skill: ptm-databases/);
assert.equal(packed.includes("Skill: answer-ptm"), false);
assert.equal(packed.includes("Skill: deep-research-ptm"), false);

const loader = readFileSync(join(here, "../src/skills/loader.ts"), "utf8");
assert.equal(loader.includes("skillsForMode"), false);
assert.equal(loader.includes("listSkillNames"), false);
assert.equal(loader.includes("deep_research"), false);
assert.equal(loader.includes("compose"), false);

const ptm = readFileSync(join(skillsDir, "ptm-databases/SKILL.md"), "utf8");
assert.equal(/breadth_search|depth_search|BFS|DFS/i.test(ptm), false);
assert.match(ptm, /search_literature/);

const bio = readFileSync(join(skillsDir, "biology-qa/SKILL.md"), "utf8");
assert.equal(/answer composer/i.test(bio), false);

console.log("skills-loader tests passed");
