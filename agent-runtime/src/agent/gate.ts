import { ParsedEntities } from "../context/memory.js";

export type QueryMode =
  | "greeting"
  | "help"
  | "capability"
  | "off_topic"
  | "concept"
  | "research"
  | "literature"
  | "pmid_lookup"
  | "collection"
  | "compare"
  | "followup";

/** Always-English instruction: user-visible answers follow the user's question language. */
export const ANSWER_LANGUAGE_RULE =
  "Write the user-visible answer in Chinese only if the user's question is in Chinese; otherwise English.";

const GREETING_RE = /^(hi|hello|hey|你好|您好|早上好|晚上好)\b/i;
const HELP_RE = /^(help|如何使用|怎么用|帮助)\b/i;
const CAPABILITY_RE = /what can you do|你能做什么|功能介绍|capabilities/i;

/** Chinese biology terms — no `\b` (JS word boundaries do not work on CJK). */
const BIO_KEYWORDS_ZH =
  /蛋白质|蛋白|氨基酸|肽|酶|基因|染色体|细胞|核酸|转录|翻译|复制|代谢|凋亡|自噬|免疫|膜|受体|核糖体|生物体|激酶|磷酸化|翻译后修饰|位点|通路|疾病|癌症|文献|修饰|信号|分子|生物学|细胞器|线粒体|细胞核|DNA|RNA/i;

/** English biology terms (`phospho\\w*` so "phosphorylation" counts). */
const BIO_KEYWORDS_EN =
  /\b(proteins?|genes?|kinases?|phospho\w*|ptms?|post-translational|ubiquitin\w*|acetyl\w*|methyl\w*|sites?|uniprot|pathways?|cells?|organism|mutation|disease|cancer|enzymes?|peptides?|amino\s+acids?|dna|rna|chromosome|apoptosis|receptor|antibody|histone|metabolism|signall?ing)\b/i;

const CONCEPT_INTENT_RE =
  /什么是|何为|介绍一下?|解释一下?|what\s+is|what\s+are|define|explain|overview\s+of|概念|基础|入门|significance\s+of|importance\s+of|role\s+of|meaning\s+of|tell\s+me\s+about/i;

const CONCEPT_TOPIC_RE =
  /蛋白质|蛋白|ptm|翻译后修饰|磷酸化|激酶|细胞|基因|酶|protein|phosphorylation|kinase|cell|gene|enzyme|post-translational|amino\s+acid|peptide|dna|rna/i;

const EDUCATIONAL_ZH_RE =
  /的意义|的作用|的功能|是什么|有啥用|为什么重要|研究意义|有什么作用|有何作用|指什么/i;

/** Phrases that mean literature-collection, not biology (avoid "import"/"parse"/"extract"). */
const COLLECTION_RE =
  /\bcollect\b|\bcurat(?:e|ing)\b|\bingest\b|qratio|quantitative\s+table|supplementary\s+table|literature\s+collection|data\s+collect|数据收集|文献收集|抽取|入库|定量表|补充表|策展/i;

const ACCESSION_RE = /(?<![A-Za-z0-9_])((?:PXD|IPX|JPST|MSV|PDC)\d+)(?![A-Za-z0-9_])/gi;

const RESOLVE_URLS_RE =
  /download\s*url|download\s*link|ftp\s*link|raw\s*file|ms\s*url|pride|iprox|jpost|massive|cptac|proteomexchange|resolve[- ]?url|get[- ]?url|下载链接|下载地址|质谱.*下载|原始数据|获取.*链接|解析.*链接/i;

const FULLTEXT_EXT = /\.(pdf|xml)$/i;
const SUPP_EXT = /\.(zip|xlsx|xls|csv|tsv)$/i;

function isBiologyRelated(message: string, entities: ParsedEntities): boolean {
  if (entities.gene || entities.uniprot_ac || entities.pmid) return true;
  return BIO_KEYWORDS_ZH.test(message) || BIO_KEYWORDS_EN.test(message);
}

function isConceptQuestion(message: string, entities: ParsedEntities): boolean {
  if (entities.gene || entities.position) return false;
  const hasIntent =
    CONCEPT_INTENT_RE.test(message) ||
    EDUCATIONAL_ZH_RE.test(message) ||
    /\b(meaning|significance|importance|purpose)\b/i.test(message);
  if (!hasIntent) return false;
  return CONCEPT_TOPIC_RE.test(message) || !entities.uniprot_ac;
}

export function detectLang(text: string): "zh" | "en" {
  const zh = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[a-z]/gi) || []).length;
  return zh >= 2 && zh >= latin * 0.35 ? "zh" : "en";
}

export function extractAccessions(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(ACCESSION_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const acc = m[1].toUpperCase();
    if (seen.has(acc)) continue;
    seen.add(acc);
    out.push(acc);
  }
  return out;
}

export function looksLikeResolveUrlsRequest(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  const accessions = extractAccessions(text);
  if (!accessions.length) return false;
  if (RESOLVE_URLS_RE.test(text)) return true;
  const stripped = text.replace(new RegExp(ACCESSION_RE.source, "gi"), " ").replace(/[\s,;:/|=#\-]+/g, "");
  return stripped.length === 0;
}

export function isCollectionUpload(filenames: string[] | undefined | null): boolean {
  if (!filenames?.length) return false;
  return filenames.some((name) => FULLTEXT_EXT.test(name) || SUPP_EXT.test(name));
}

export function isCollectionRequest(
  message: string,
  entities: ParsedEntities,
  uploadFilenames: string[] = [],
): boolean {
  if (isCollectionUpload(uploadFilenames)) return true;
  const text = (message || "").trim();
  if (looksLikeResolveUrlsRequest(text)) return true;
  if (COLLECTION_RE.test(text)) return true;
  if (entities.pmid && /collect|extract|curat|ingest|qratio|收集|抽取|入库/i.test(text)) {
    return true;
  }
  return false;
}

/** Greeting / concept / refuse — never run Deep Research tools or clarification. */
export function shouldSkipInvestigation(mode: QueryMode): boolean {
  return (
    mode === "greeting" ||
    mode === "help" ||
    mode === "capability" ||
    mode === "off_topic" ||
    mode === "concept"
  );
}

export function ptmResearchSteer(lang: "zh" | "en"): string {
  return lang === "zh"
    ? "若要落到具体 PTM 研究，可以问：「哪些激酶磷酸化 AKT1 S473？」或「TP53 S15 在 DNA 损伤后如何被磷酸化？」"
    : "To move into a PTM investigation, try: \"Which kinases phosphorylate AKT1 S473?\" or \"How is TP53 S15 phosphorylated after DNA damage?\"";
}

export function classifyQueryMode(
  message: string,
  entities: ParsedEntities,
  uploadFilenames: string[] = [],
): QueryMode {
  const m = (message || "").trim();
  if (isCollectionRequest(m, entities, uploadFilenames)) return "collection";
  if (!m) return "research";
  if (GREETING_RE.test(m)) return "greeting";
  if (HELP_RE.test(m)) return "help";
  if (CAPABILITY_RE.test(m)) return "capability";
  if (entities.pmid && /pmid|文献|paper|abstract/i.test(m)) return "pmid_lookup";
  if (/literature|pubmed|论文|文献综述|recent papers/i.test(m)) return "literature";
  if (/这些|上面|继续|对比|compare|follow up|刚才/i.test(m)) return "followup";
  if (!isBiologyRelated(m, entities)) {
    return "off_topic";
  }
  if (isConceptQuestion(m, entities)) return "concept";
  if (/什么是|what is|explain|概念|机制概述|overview of/i.test(m) && !entities.position) return "concept";
  return "research";
}

export function gateReply(mode: QueryMode, lang: "zh" | "en"): string | null {
  const steer = ptmResearchSteer(lang);
  if (mode === "greeting") {
    return lang === "zh"
      ? `你好！我是 **qPTM 的 PTM 研究助手**，整合定量翻译后修饰数据与激酶、条件、定位、功能与疾病等资源。简单概念题我会直接说明；具体位点或机制问题会自动检索数据库与文献。\n\n${steer}`
      : `Hello! I'm the **qPTM PTM research assistant**. I combine quantitative PTM data with kinases, conditions, localization, function and disease resources. Simple concepts get a direct explanation; site- or mechanism-level questions automatically search databases and literature.\n\n${steer}`;
  }
  if (mode === "help") {
    return lang === "zh"
      ? `直接提问即可。生物概念（如「什么是蛋白质」）我会短答，并引到 PTM 研究；具体基因/位点问题会自动做多库调研。上传 PDF 可采集文献中的定量 PTM 表。\n\n${steer}`
      : `Just ask. Biology concepts (e.g. "What is a protein?") get a short answer that leads into PTM research; gene/site questions automatically run a multi-database investigation. Upload a PDF to collect quantitative PTM tables from a paper.\n\n${steer}`;
  }
  if (mode === "capability") {
    return lang === "zh"
      ? `我是 qPTM Agent：面向翻译后修饰（PTM）研究，覆盖位点鉴定、上游酶、定量条件、亚细胞定位、功能/疾病与药物调控，并可检索文献。概念题直接答；需要证据的问题会自动走数据库与文献调研。\n\n${steer}`
      : `I am the qPTM Agent for post-translational modification (PTM) research: site identification, upstream enzymes, quantitative conditions, localization, function/disease and drugs, plus literature. Concepts are answered directly; evidence-seeking questions automatically query databases and papers.\n\n${steer}`;
  }
  if (mode === "off_topic") {
    return lang === "zh"
      ? `我是 **qPTM 的 PTM 研究助手**，只回答分子与细胞生物学、蛋白质和翻译后修饰相关问题，不能回答其他领域的概念或闲聊。\n\n${steer}`
      : `I am the **qPTM PTM research assistant**. I only answer molecular/cell biology, protein, and post-translational modification questions — not other topics.\n\n${steer}`;
  }
  return null;
}

export function needsLiterature(message: string): boolean {
  return /literature|paper|pubmed|recent studies|文献|论文|研究进展/i.test(message);
}
