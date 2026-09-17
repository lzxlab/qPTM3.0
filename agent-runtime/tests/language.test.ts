import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWER_LANGUAGE_RULE } from "../src/agent/language.js";
import { ptmSteerFollowUps } from "../src/agent/followups.js";
import { failedGenerationMessage } from "../src/agent/protocol.js";

const CJK = /[\u4e00-\u9fff]/;
const here = dirname(fileURLToPath(import.meta.url));
const agentSrc = join(here, "../src/agent");

assert.match(
  ANSWER_LANGUAGE_RULE,
  /Write the user-visible answer in Chinese only if the user's question is in Chinese/,
);
assert.equal(CJK.test(ANSWER_LANGUAGE_RULE), false);

for (const q of ptmSteerFollowUps()) {
  assert.equal(CJK.test(q.text), false, q.text);
}
assert.equal(CJK.test(failedGenerationMessage()), false);

const promptFiles = ["run.ts", "react-loop.ts", "collection.ts"];
for (const file of promptFiles) {
  const src = readFileSync(join(agentSrc, file), "utf8");
  const setPhaseCalls = src.match(/setPhase\((?:[^()]*|\([^()]*\))*\)/gs) || [];
  for (const call of setPhaseCalls) {
    assert.equal(CJK.test(call), false, `${file} setPhase still has CJK:\n${call}`);
  }
}

const react = readFileSync(join(agentSrc, "react-loop.ts"), "utf8");
assert.match(react, /ANSWER_LANGUAGE_RULE/);

const follow = readFileSync(join(agentSrc, "followups.ts"), "utf8");
assert.match(follow, /Write each "text" in Chinese only if the user's question is in Chinese/);
assert.equal(follow.includes("根据本轮调研生成"), false);

assert.equal(existsSync(join(agentSrc, "gate.ts")), false);
assert.equal(existsSync(join(agentSrc, "clarification.ts")), false);

console.log("language tests passed");
