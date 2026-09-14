import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWER_LANGUAGE_RULE, detectLang } from "../src/agent/gate.js";
import { ptmSteerFollowUps } from "../src/agent/followups.js";
import { failedGenerationMessage } from "../src/agent/protocol.js";

const CJK = /[\u4e00-\u9fff]/;
const here = dirname(fileURLToPath(import.meta.url));
const agentSrc = join(here, "../src/agent");

assert.equal(detectLang("哪些激酶磷酸化 AKT1 S473？"), "zh");
assert.equal(detectLang("Which kinases phosphorylate AKT1 S473?"), "en");
assert.match(
  ANSWER_LANGUAGE_RULE,
  /Write the user-visible answer in Chinese only if the user's question is in Chinese/,
);
assert.equal(CJK.test(ANSWER_LANGUAGE_RULE), false);

for (const q of ptmSteerFollowUps("en")) {
  assert.equal(CJK.test(q.text), false, q.text);
}
for (const q of ptmSteerFollowUps("zh")) {
  assert.equal(CJK.test(q.text), true, q.text);
}
assert.equal(CJK.test(failedGenerationMessage("en")), false);
assert.equal(CJK.test(failedGenerationMessage("zh")), true);

const promptFiles = ["qa-react.ts", "deep-research.ts", "dr-research-loop.ts", "run.ts"];
for (const file of promptFiles) {
  const src = readFileSync(join(agentSrc, file), "utf8");
  const setPhaseCalls = src.match(/setPhase\((?:[^()]*|\([^()]*\))*\)/gs) || [];
  for (const call of setPhaseCalls) {
    assert.equal(CJK.test(call), false, `${file} setPhase still has CJK:\n${call}`);
  }
  assert.equal(
    /setPhase\([^;]*lang === "zh"/.test(src),
    false,
    `${file} still switches setPhase on lang`,
  );
}

const qa = readFileSync(join(agentSrc, "qa-react.ts"), "utf8");
const dr = readFileSync(join(agentSrc, "deep-research.ts"), "utf8");
const loop = readFileSync(join(agentSrc, "dr-research-loop.ts"), "utf8");
assert.match(qa, /ANSWER_LANGUAGE_RULE/);
assert.match(dr, /ANSWER_LANGUAGE_RULE/);
assert.match(loop, /You are the PTM deep-research supervisor/);
assert.equal(qa.includes("你是 qPTM 生物学专家"), false);
assert.equal(dr.includes("你是 PTM 深度调研专家"), false);
assert.equal(loop.includes("你是 PTM 深度调研调度器"), false);

const clarify = readFileSync(join(agentSrc, "clarification.ts"), "utf8");
assert.match(clarify, /You are the qPTM deep-research assistant/);
assert.equal(clarify.includes("你是 qPTM 深度调研助手"), false);
assert.match(clarify, /Write all user-visible copy/);

const follow = readFileSync(join(agentSrc, "followups.ts"), "utf8");
assert.match(follow, /Write each "text" in Chinese only if the user's question is in Chinese/);
assert.equal(follow.includes("根据本轮调研生成"), false);

console.log("language tests passed");
