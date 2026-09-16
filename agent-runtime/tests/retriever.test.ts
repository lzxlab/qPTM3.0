import assert from "node:assert/strict";
import { parseToolIndices, retrieveIntentTools } from "../src/agent/retriever.js";
import { parseEntities } from "../src/context/memory.js";

assert.deepEqual(parseToolIndices("TOOLS: []", 10), []);
assert.deepEqual(parseToolIndices("TOOLS: [0, 2, 5]", 10), [0, 2, 5]);
assert.deepEqual(parseToolIndices("here you go\nTOOLS: [1, 1, 3]\n", 5), [1, 3]);
assert.equal(parseToolIndices("no indices here", 10), null);
assert.equal(parseToolIndices("TOOLS: [99]", 3), null);

const memory = { gene: "AKT1", position: 473, uniprot_ac: "P31749", ptm_type: "phosphorylation" };
const kinaseTools = retrieveIntentTools("Which kinases phosphorylate AKT1 S473?", memory, 6);
assert.ok(kinaseTools.includes("get_upstream_enzymes"));

const greetingFallback = retrieveIntentTools("hello", parseEntities("hello"), 4);
assert.ok(Array.isArray(greetingFallback));

console.log("retriever tests passed");
