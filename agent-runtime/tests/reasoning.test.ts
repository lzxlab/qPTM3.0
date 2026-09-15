import assert from "node:assert/strict";
import { extractReasoning, isEmptyLlmResult } from "../src/llm/reasoning.js";

assert.equal(extractReasoning(null), "");
assert.equal(extractReasoning({ content: "hello" }), "");
assert.equal(extractReasoning({ reasoning_content: "need kinases" }), "need kinases");
assert.equal(extractReasoning({ reasoning: "gap in disease" }), "gap in disease");
assert.equal(extractReasoning({ thinking: "plan sections" }), "plan sections");
assert.equal(extractReasoning({ reasoning: { content: "nested" } }), "nested");

assert.equal(isEmptyLlmResult("", []), true);
assert.equal(isEmptyLlmResult("", [{ name: "x" }]), false);
assert.equal(isEmptyLlmResult("hello", []), false);
assert.equal(isEmptyLlmResult("", []), true);

const onlyThinking = { reasoning_content: "internal plan", content: "" };
assert.equal(extractReasoning(onlyThinking), "internal plan");
assert.equal(isEmptyLlmResult(onlyThinking.content, []), true);

console.log("reasoning tests passed");
