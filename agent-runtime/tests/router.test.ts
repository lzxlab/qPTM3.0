import assert from "node:assert/strict";
import { classifyQueryMode } from "../src/agent/gate.js";
import { routeQuery, isSpecificEnough } from "../src/agent/router.js";
import { parseEntities } from "../src/context/memory.js";

const MAX = 4;

function route(
  message: string,
  memory: Record<string, unknown> = {},
  extra: {
    clarificationResponse?: { skip?: boolean } | null;
    clarifyRound?: number;
    skippedClarify?: boolean;
  } = {},
) {
  const parsed = parseEntities(message);
  const queryMode = classifyQueryMode(message, parsed);
  return routeQuery({
    queryMode,
    clarificationResponse: extra.clarificationResponse ?? null,
    memory: {
      gene: (memory.gene as string) || "",
      position: Number(memory.position) || 0,
      uniprot_ac: (memory.uniprot_ac as string) || "",
      ptm_type: (memory.ptm_type as string) || "phosphorylation",
      organism: "human",
      findings_summary: "",
      query_mode: queryMode,
    },
    clarifyRound: extra.clarifyRound ?? 0,
    maxClarifyRounds: MAX,
    skippedClarify: extra.skippedClarify,
  });
}

assert.equal(route("What is phosphorylation?").handler, "qa_direct");
assert.equal(route("Which kinases phosphorylate AKT1 S473?", { gene: "AKT1", position: 473, uniprot_ac: "P31749" }).handler, "investigate");
assert.equal(
  route("Which kinases phosphorylate AKT1?", { gene: "AKT1" }).handler,
  "clarify",
);
assert.equal(
  route("Which kinases phosphorylate AKT1?", { gene: "AKT1" }, { clarifyRound: MAX }).handler,
  "investigate",
);
assert.equal(
  route("Which kinases phosphorylate AKT1?", { gene: "AKT1" }, { skippedClarify: true }).handler,
  "investigate",
);

assert.equal(isSpecificEnough({ gene: "AKT1", position: 473, uniprot_ac: "P31749", ptm_type: "", organism: "human", findings_summary: "" }), true);
assert.equal(isSpecificEnough({ gene: "AKT1", position: 0, uniprot_ac: "", ptm_type: "", organism: "human", findings_summary: "" }), false);

console.log("router tests passed");
