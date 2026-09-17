import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAccessions,
  isCollectionRequest,
  looksLikeResolveUrlsRequest,
} from "../src/agent/collection.js";
import { ANSWER_LANGUAGE_RULE } from "../src/agent/language.js";
import { parseEntities } from "../src/context/memory.js";

function collect(message: string, files: string[] = []) {
  return isCollectionRequest(message, parseEntities(message), files);
}

assert.equal(collect("Collect quantitative PTM data from PMID 39732660"), true);
assert.equal(collect("从 PMID 38101750 抽取 qratio 定量表"), true);
assert.equal(collect("hello", ["39732660.pdf"]), true);
assert.equal(collect("帮我获取 PRIDE 数据库中 ID=PXD037009 的质谱下载链接"), true);
assert.equal(looksLikeResolveUrlsRequest("PXD037009"), true);
assert.deepEqual(extractAccessions("中PXD005871 和 IPX0004109000"), ["PXD005871", "IPX0004109000"]);

assert.equal(collect("Does TP53 have a nuclear import signal?"), false);
assert.equal(collect("Which kinases phosphorylate AKT1 S473?"), false);
assert.equal(collect("What is phosphorylation?"), false);
assert.equal(collect("hello"), false);
assert.equal(isCollectionRequest("nuclear import of TP53", parseEntities("nuclear import of TP53")), false);

assert.match(ANSWER_LANGUAGE_RULE, /Chinese only if the user's question is in Chinese/i);

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/agent/collection.ts"), "utf8");
assert.equal(/[\u4e00-\u9fff]/.test(src), false, "collection regex source must not contain CJK literals");

console.log("classify tests passed");
