import assert from "node:assert/strict";
import {
  ANSWER_LANGUAGE_RULE,
  classifyQueryMode,
  detectLang,
  extractAccessions,
  gateReply,
  isCollectionRequest,
  looksLikeResolveUrlsRequest,
  shouldSkipInvestigation,
} from "../src/agent/gate.js";
import { parseEntities } from "../src/context/memory.js";

function mode(message: string, files: string[] = []) {
  return classifyQueryMode(message, parseEntities(message), files);
}

assert.equal(mode("Collect quantitative PTM data from PMID 39732660"), "collection");
assert.equal(mode("从 PMID 38101750 抽取 qratio 定量表"), "collection");
assert.equal(mode("hello", ["39732660.pdf"]), "collection");
assert.equal(mode("帮我获取 PRIDE 数据库中 ID=PXD037009 的质谱下载链接"), "collection");
assert.equal(looksLikeResolveUrlsRequest("PXD037009"), true);
assert.deepEqual(extractAccessions("中PXD005871 和 IPX0004109000"), ["PXD005871", "IPX0004109000"]);

assert.equal(mode("Does TP53 have a nuclear import signal?"), "research");
assert.equal(mode("Parse the role of TP53 S15 phosphorylation"), "research");
assert.equal(mode("Which kinases phosphorylate AKT1 S473?"), "research");
assert.equal(isCollectionRequest("nuclear import of TP53", parseEntities("nuclear import of TP53")), false);

assert.equal(mode("hello"), "greeting");
assert.equal(mode("What is a protein?"), "concept");
assert.equal(mode("What is phosphorylation?"), "concept");
assert.equal(mode("什么是蛋白质"), "concept");
assert.equal(mode("什么是磷酸化"), "concept");
assert.equal(mode("What is bitcoin?"), "off_topic");
assert.equal(mode("什么是比特币"), "off_topic");
assert.equal(mode("Who won the World Cup?"), "off_topic");

assert.equal(shouldSkipInvestigation("concept"), true);
assert.equal(shouldSkipInvestigation("off_topic"), true);
assert.equal(shouldSkipInvestigation("greeting"), true);
assert.equal(shouldSkipInvestigation("help"), true);
assert.equal(shouldSkipInvestigation("capability"), true);
assert.equal(shouldSkipInvestigation("research"), false);
assert.equal(shouldSkipInvestigation("literature"), false);
assert.equal(shouldSkipInvestigation(mode("Which kinases phosphorylate AKT1 S473?")), false);
assert.equal(shouldSkipInvestigation(mode("TP53 S15 phosphorylation after DNA damage")), false);
assert.equal(shouldSkipInvestigation(mode("What is phosphorylation?")), true);
assert.equal(shouldSkipInvestigation(mode("What is bitcoin?")), true);

const off = gateReply("off_topic", "zh") || "";
assert.match(off, /qPTM/);
assert.match(off, /PTM 研究助手/);
assert.match(off, /AKT1 S473/);
const offEn = gateReply("off_topic", "en") || "";
assert.match(offEn, /qPTM PTM research assistant/);
assert.match(offEn, /AKT1 S473/);
const conceptSteer = gateReply("greeting", "zh") || "";
assert.match(conceptSteer, /AKT1 S473|TP53 S15/);
assert.match(conceptSteer, /你好/);

assert.equal(detectLang("哪些激酶磷酸化 AKT1 S473？"), "zh");
assert.equal(detectLang("Which kinases phosphorylate AKT1 S473?"), "en");
assert.match(ANSWER_LANGUAGE_RULE, /Chinese only if the user's question is in Chinese/i);

console.log("classify tests passed");
