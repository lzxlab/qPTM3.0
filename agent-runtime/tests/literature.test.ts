import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "../src/config.js";
import {
  extractPmids,
  literatureTokens,
  papersFromToolResult,
  papersNeedAbstracts,
  mergeLiteratureResults,
  rankLiteraturePapers,
  withFrontierEntities,
  entitiesMissingFromQuery,
  geneLikeTokens,
} from "../src/agent/literature.js";
import { isWebSearchFailure } from "../src/mcp/hub.js";

assert.equal(cfg.litSearchLimit, 20);
assert.equal(cfg.litAbstractLimit, 10);
assert.equal(cfg.litFulltextLimit, 3);
assert.equal(cfg.litBreadthLimit, 10);
assert.equal(cfg.litDepthRounds, 2);

const ids = extractPmids('PMID:11111111 and {"pmid":"22222222"} extra PMID:11111111', 10);
assert.deepEqual(ids, ["11111111", "22222222"]);

const papers = papersFromToolResult({
  success: true,
  summary: "ok",
  data: null,
  blocks: [
    {
      rows: [
        { pmid: "33333333", title: "AKT1 S473 kinase paper", abstract: "phosphorylation of AKT1" },
        { pmid: "44444444", title: "unrelated metabolomics", abstract: "lipidomics in plants" },
      ],
    },
  ],
});
assert.equal(papers.length, 2);
assert.equal(papersNeedAbstracts(papers), false);
assert.equal(papersNeedAbstracts([{ pmid: "11111111", title: "t", abstract: "" }]), true);

const merged = mergeLiteratureResults(
  { success: true, summary: "Merged 2 unique PMID(s)", data: null, blocks: [{ rows: [{ pmid: "33333333" }] }] },
  {
    success: true,
    summary: "2 abstracts",
    data: null,
    blocks: [{ rows: [{ pmid: "33333333", abstract: "phosphorylation of AKT1" }] }],
  },
);
assert.match(merged.summary, /Fetched 1 abstract/);
assert.equal((merged.blocks || []).length, 2);

const tokens = literatureTokens({ gene: "AKT1", position: 473, ptm_type: "phosphorylation" }, "kinase", "");
const ranked = rankLiteraturePapers(papers, tokens, "AKT1");
assert.equal(ranked[0].pmid, "33333333");
assert.equal(ranked.some((p) => p.pmid === "44444444"), false);

const hub = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/mcp/hub.ts"), "utf8");
assert.equal(hub.includes("biomcpSearchArticle"), false);
assert.equal(hub.includes("callBiomcp"), false);
assert.equal(hub.includes("biomcp"), false);
assert.match(hub, /api\.tavily\.com\/search/);
assert.match(hub, /Tavily not configured/);
const loop = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/agent/dr-research-loop.ts"), "utf8");
assert.equal(loop.includes("biomcpGetArticle"), false);
assert.match(loop, /isWebSearchFailure/);
assert.match(loop, /fulltext_pmids/);
assert.match(loop, /litAbstractLimit/);
assert.match(loop, /litBreadthLimit/);
assert.equal(withFrontierEntities("AKT1 S473 kinase", ["TBK1", "AKT1"]), "AKT1 S473 kinase TBK1");
assert.deepEqual(entitiesMissingFromQuery("AKT1 S473 kinase TBK1", ["TBK1", "MTOR"]), ["MTOR"]);
assert.deepEqual(geneLikeTokens("TBK1 phosphorylates AKT1", ["AKT1"]), ["TBK1"]);

assert.equal(isWebSearchFailure("Web search unavailable: Tavily not configured"), true);
assert.equal(isWebSearchFailure("Web search failed: Tavily HTTP 401"), true);
assert.equal(isWebSearchFailure("AKT1 phosphorylation review\nhttps://example.org"), false);

const qa = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/agent/qa-react.ts"), "utf8");
assert.match(qa, /name: "web_search"/);
const react = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/agent/react-loop.ts"), "utf8");
assert.match(react, /name: "web_search"/);
assert.match(react, /callSearchLiteratureDeep/);
assert.equal(qa.includes("needsWebSearch"), false);
const gate = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/agent/gate.ts"), "utf8");
assert.equal(gate.includes("needsWebSearch"), false);
assert.equal(/latest\|recent news\|2024\|2025\|2026/.test(gate), false);

console.log("literature tests passed");
