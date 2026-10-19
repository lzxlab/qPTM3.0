#!/usr/bin/env npx tsx
/**
 * M109 benchmark: Stage 1 recall + Stage 3 held-out metadata vs manual CSV gold.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { ScreenChain } from "../../src/chains/screen/agent.js"
import { MetaChain } from "../../src/chains/meta/agent.js"
import { selectKnownIdentifiersForMeta } from "../../src/stage2/accessions.js"
import { loadFulltextExcerpt } from "../../src/stage3/text.js"
import { resolveAbstractsForPmids } from "../../src/stage1/resolve-abstracts.js"
import { createLlmRuntime, loadDotEnv } from "../../src/runtime.js"
import type { LiteratureInfoRow } from "../../src/types.js"
import {
  parseCsv,
  projectRoot,
  readTextFile,
  stage2ManifestJsonlPath,
} from "../../src/utils/io.js"
import type { Stage2Manifest } from "../../src/stage2/discover.js"

const FEWSHOT_PMIDS = new Set(["38101750", "35931320", "35659261"])
const SPLIT_SEED = 20260314
const TEST_FRACTION = 0.3

const MANUAL_CSV = join(projectRoot(), "evaluation_data/qPTM3_manul_collect_109pmids.csv")
const SPLITS_DIR = join(projectRoot(), "evaluation_data/splits")
const RESULTS_DIR = join(projectRoot(), "evaluation_data/results")

export interface ManualGoldRow {
  pmid: string
  title: string
  sample: string
  sampleType: string
  organism: string
  ptms: string
  labelMethod: string
  condition: string
  detailCondition: string
  enrichmentMethod: string
  massSpectrometer: string
  msDataSource: string
  identifier: string
}

function mergeMultiValueField(values: string[]): string {
  const parts = new Set<string>()
  for (const raw of values) {
    for (const piece of raw.split(/[;|,]+/)) {
      const t = piece.trim()
      if (t) parts.add(t)
    }
  }
  return [...parts].join("; ")
}

/** Prefer the row matching the main PTM focus (phospho first) for instrument / primary enrich. */
function primaryPtmGoldRow(rows: ManualGoldRow[]): ManualGoldRow {
  const order = ["phosphorylation", "ubiquitylation", "acetylation", "glycosylation", "methylation"]
  for (const ptm of order) {
    const hit = rows.find((r) => r.ptms.toLowerCase().includes(ptm))
    if (hit) return hit
  }
  return rows[0]
}

function sanitizeGoldMSFields(s: string): string {
  return normWs(s)
    .replace(/TiO__/gi, "TiO2")
    .replace(/Q Exactive__/gi, "Q Exactive")
    .replace(/Exploris__/gi, "Exploris")
    .replace(/Fe³__-NTA|Fe³³__-NTA/gi, "Fe-NTA")
    .replace(/Fe³__-IMAC/gi, "Fe-IMAC")
    .replace(/Titansphere__/gi, "Titansphere")
    .replace(/TiO__-/gi, "TiO2-")
}

/** One gold row per PMID (M109 CSV may list multiple PTM/dataset rows per paper). */
function mergeManualGoldRows(rows: ManualGoldRow[]): ManualGoldRow {
  const first = rows[0]
  const primary = primaryPtmGoldRow(rows)
  const pickLongest = (fn: (r: ManualGoldRow) => string) => {
    let best = ""
    for (const r of rows) {
      const v = fn(r).trim()
      if (v.length > best.length) best = v
    }
    return best
  }
  return {
    pmid: first.pmid,
    title: pickLongest((r) => r.title),
    sample: mergeMultiValueField(rows.map((r) => r.sample)),
    sampleType: mergeMultiValueField(rows.map((r) => r.sampleType)),
    organism: mergeMultiValueField(rows.map((r) => r.organism)),
    ptms: mergeMultiValueField(rows.map((r) => r.ptms)),
    labelMethod: mergeMultiValueField(rows.map((r) => r.labelMethod)),
    condition: mergeMultiValueField(rows.map((r) => r.condition)),
    detailCondition: rows
      .map((r) => r.detailCondition.trim())
      .filter(Boolean)
      .join(" "),
    enrichmentMethod: sanitizeGoldMSFields(
      mergeMultiValueField(rows.map((r) => sanitizeGoldMSFields(r.enrichmentMethod))),
    ),
    massSpectrometer: sanitizeGoldMSFields(
      primary.massSpectrometer.trim() || pickLongest((r) => r.massSpectrometer),
    ),
    msDataSource: mergeMultiValueField(rows.map((r) => r.msDataSource)),
    identifier: mergeMultiValueField(rows.map((r) => r.identifier)),
  }
}

function loadManualGold(): ManualGoldRow[] {
  const rows = parseCsv(readTextFile(MANUAL_CSV))
  const h = rows[0].map((x) => x.trim().replace(/^\uFEFF/, ""))
  const idx = (name: string) => h.findIndex((c) => c.toLowerCase() === name.toLowerCase())
  const byPmid = new Map<string, ManualGoldRow[]>()
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const pmid = (r[idx("PMID")] ?? "").trim()
    if (!/^\d+$/.test(pmid)) continue
    const row: ManualGoldRow = {
      pmid,
      title: (r[idx("Title")] ?? "").trim(),
      sample: (r[idx("Sample")] ?? "").trim(),
      sampleType: (r[idx("Sample type")] ?? "").trim(),
      organism: (r[idx("Organism")] ?? "").trim(),
      ptms: (r[idx("PTMs")] ?? "").trim(),
      labelMethod: (r[idx("Label method")] ?? "").trim(),
      condition: (r[idx("Condition")] ?? "").trim(),
      detailCondition: (r[idx("Detail condition")] ?? "").trim(),
      enrichmentMethod: sanitizeGoldMSFields((r[idx("Enrichment method")] ?? "").trim()),
      massSpectrometer: sanitizeGoldMSFields((r[idx("Mass spectrometer")] ?? "").trim()),
      msDataSource: (r[idx("MS data source")] ?? "").trim(),
      identifier: (r[idx("Identifier")] ?? "").trim(),
    }
    if (!byPmid.has(pmid)) byPmid.set(pmid, [])
    byPmid.get(pmid)!.push(row)
  }
  return [...byPmid.values()].map(mergeManualGoldRows).sort((a, b) => a.pmid.localeCompare(b.pmid))
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function organismBucket(org: string): string {
  const o = org.toLowerCase()
  if (o.includes("homo sapiens") || o.includes("(human)")) return "human"
  if (o.includes("mus musculus") || o.includes("(mouse)")) return "mouse"
  if (o.includes("rattus") || o.includes("(rat)")) return "rat"
  if (o.includes("saccharomyces") || o.includes("yeast")) return "yeast"
  return "other"
}

function stratumKey(row: ManualGoldRow): string {
  const ptm = (row.ptms.split(";")[0] || "Other").trim().toLowerCase()
  return `${ptm}|${organismBucket(row.organism)}`
}

export function buildM109Split(gold: ManualGoldRow[]): {
  allPmids: string[]
  fewshotExclude: string[]
  dev: string[]
  test: string[]
} {
  const pool = gold.filter((g) => !FEWSHOT_PMIDS.has(g.pmid))
  const byStratum = new Map<string, ManualGoldRow[]>()
  for (const row of pool) {
    const k = stratumKey(row)
    if (!byStratum.has(k)) byStratum.set(k, [])
    byStratum.get(k)!.push(row)
  }
  const rng = mulberry32(SPLIT_SEED)
  const test: string[] = []
  const dev: string[] = []
  for (const [, items] of [...byStratum.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const shuffled = [...items].sort(() => rng() - 0.5)
    const nTest = Math.max(1, Math.round(shuffled.length * TEST_FRACTION))
    for (let i = 0; i < shuffled.length; i++) {
      if (i < nTest) test.push(shuffled[i].pmid)
      else dev.push(shuffled[i].pmid)
    }
  }
  test.sort()
  dev.sort()
  return {
    allPmids: gold.map((g) => g.pmid),
    fewshotExclude: [...FEWSHOT_PMIDS],
    dev,
    test,
  }
}

function loadDiscoverByPmid(): Map<string, Stage2Manifest> {
  const path = stage2ManifestJsonlPath()
  const map = new Map<string, Stage2Manifest>()
  if (!existsSync(path)) return map
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const row = JSON.parse(t) as Stage2Manifest
      if (row.pmid) map.set(row.pmid, row)
    } catch {
      // skip
    }
  }
  return map
}

function normWs(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/** Split multi-valued metadata (keeps condition contrasts with `/` intact). */
function splitMultiLabel(raw: string, opts: { allowComma?: boolean } = {}): string[] {
  const re = opts.allowComma ? /[;|,]+/ : /[;|]+/
  return raw
    .split(re)
    .map((x) => normWs(x))
    .filter(Boolean)
}

function setF1FromTokenLists(goldTokens: string[], predTokens: string[]): number {
  const g = new Set(goldTokens)
  const p = new Set(predTokens)
  if (g.size === 0 && p.size === 0) return 1
  if (g.size === 0 || p.size === 0) return 0
  let inter = 0
  for (const x of g) if (p.has(x)) inter++
  const prec = inter / p.size
  const rec = inter / g.size
  if (prec + rec === 0) return 0
  return (2 * prec * rec) / (prec + rec)
}

function normMsSourceToken(s: string): string {
  const t = normWs(s)
  if (!t) return ""
  const u = t.toLowerCase()
  if (u.includes("iprox")) return "iprox"
  if (u.includes("proteomexchange")) return "proteomexchange"
  if (u.includes("pride")) return "pride"
  if (u.includes("massive")) return "massive"
  if (u.includes("jpost")) return "jpost"
  if (u.includes("cptac")) return "cptac"
  return u
}

const ORGANISM_ALIASES: Record<string, string> = {
  human: "homo sapiens",
  mouse: "mus musculus",
  rat: "rattus norvegicus",
  yeast: "saccharomyces cerevisiae",
}

function organismTokens(raw: string): string[] {
  const out = new Set<string>()
  for (const part of splitMultiLabel(raw)) {
    const s = normWs(part).toLowerCase()
    const paren = s.match(/\((human|mouse|rat|yeast)\)/i)
    if (paren) out.add(ORGANISM_ALIASES[paren[1].toLowerCase()] ?? paren[1].toLowerCase())
    const beforeParen = s.split("(")[0].trim()
    const binomial = beforeParen.match(/^([a-z]+)\s+([a-z]+)/)
    if (binomial) {
      out.add(`${binomial[1]} ${binomial[2]}`)
      continue
    }
    for (const [alias, canon] of Object.entries(ORGANISM_ALIASES)) {
      if (s.includes(alias)) out.add(canon)
    }
    if (beforeParen) out.add(beforeParen)
  }
  return [...out].sort()
}

function normLabelToken(t: string): string {
  let x = normWs(t).toLowerCase()
  if (/label[\s-]*free/.test(x)) return "label-free"
  const tmt = x.match(/\btmt[\s-]*(\d+[\s-]*plex|\d+-plex|\d+\s*plex)?/i)
  if (tmt) {
    const n = tmt[0].match(/(\d+)/)?.[1]
    return n ? `tmt ${n}-plex` : "tmt"
  }
  if (/\b6[\s-]*plex\s*tmt|\btmt[\s-]*6/i.test(x)) return "tmt 6-plex"
  if (/\b10[\s-]*plex|\btmt[\s-]*10/i.test(x)) return "tmt 10-plex"
  if (/\bsilac\b/i.test(x)) return "silac"
  if (/\bdia\b/i.test(x)) return "dia"
  if (/\bitraq\b/i.test(x)) return "itraq"
  return x
}

function labelMethodTokens(raw: string): string[] {
  return splitMultiLabel(raw).map(normLabelToken).filter(Boolean).sort()
}

function labelFamilyTags(token: string): string[] {
  const out = new Set<string>([token])
  const u = token.toLowerCase()
  if (u.includes("tmt")) out.add("tmt")
  if (u.includes("silac")) out.add("silac")
  if (u.includes("label-free") || u.includes("label free")) out.add("label-free")
  if (u.includes("dia")) out.add("dia")
  if (u.includes("itraq")) out.add("itraq")
  return [...out]
}

function labelMethodTokensExpanded(raw: string): string[] {
  const out = new Set<string>()
  for (const t of labelMethodTokens(raw)) {
    for (const tag of labelFamilyTags(t)) out.add(tag)
  }
  return [...out].sort()
}

/** Pull accession IDs from free text (not only `;`-split fields). */
function scanAccessions(raw: string): string[] {
  const matches = raw.match(/\b(PXD|IPX|MSV|JPST|PDC)\d+\b/gi) ?? []
  return [...new Set(matches.map((m) => m.toUpperCase()))].sort()
}

function identifierTokens(raw: string): string[] {
  return scanAccessions(raw)
}

function predIdentifierText(pred: LiteratureInfoRow): string {
  return [pred.identifier, pred.notes].filter(Boolean).join(" ")
}

/** Any correct accession in pred (identifier / notes) → 1; else partial F1 ≥ 0.5 → 1. */
function identifierRelaxedScore(gold: ManualGoldRow, pred: LiteratureInfoRow): number {
  const goldIds = scanAccessions(gold.identifier)
  if (goldIds.length === 0) return 1
  const predText = predIdentifierText(pred)
  const predIds = scanAccessions(predText)
  const predNorm = normLooseText(predText)
  for (const id of goldIds) {
    if (predIds.includes(id)) return 1
    if (predNorm.includes(id.toLowerCase())) return 1
  }
  const f1 = setF1FromTokenLists(goldIds, predIds)
  if (f1 >= 0.5) return 1
  return 0
}

function labelMethodRelaxedScore(gold: ManualGoldRow, pred: LiteratureInfoRow): number {
  const hit = relaxedFieldHitScore(
    gold.labelMethod,
    pred.labelMethod,
    labelMethodTokensExpanded,
  )
  if (hit >= 1) return 1
  const f1 = setF1FromTokenLists(
    labelMethodTokensExpanded(gold.labelMethod),
    labelMethodTokensExpanded(pred.labelMethod),
  )
  if (f1 >= 0.5) return 1
  return 0
}

function msSourceTokens(raw: string): string[] {
  return splitMultiLabel(raw, { allowComma: true }).map(normMsSourceToken).filter(Boolean).sort()
}

const LOOSE_STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "after",
  "before",
  "from",
  "into",
  "min",
  "mins",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "treated",
  "treatment",
  "group",
  "groups",
  "sample",
  "samples",
  "vs",
  "versus",
  "compared",
  "control",
  "ctr",
])

function normLooseText(s: string): string {
  return normWs(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function significantWords(s: string, minLen = 3): string[] {
  return normLooseText(s)
    .split(/\s+/)
    .filter((w) => w.length >= minLen && !LOOSE_STOPWORDS.has(w))
}

function normSampleName(s: string): string {
  let x = normLooseText(s)
  x = x.replace(/\btissues?\b/g, " ").replace(/\bcells?\b/g, " ").replace(/\s+/g, " ").trim()
  if (/^yeast$/.test(x)) return "yeast"
  return x || normLooseText(s)
}

function splitSampleParts(raw: string): string[] {
  return raw
    .split(/[;|,]|(?:\band\b)|\//i)
    .map(normSampleName)
    .filter(Boolean)
}

/** Focal sample names + salient words (Stage 5 may complete the list). */
function sampleNameTokens(raw: string): string[] {
  const out = new Set<string>()
  for (const part of splitSampleParts(raw)) {
    out.add(part)
    for (const w of significantWords(part, 4)) out.add(w)
  }
  return [...out].sort()
}

function softenConditionArm(s: string): string {
  let x = normLooseText(s)
  x = x.replace(/\bknock[\s-]?out\b/g, "ko")
  x = x.replace(/\bover[\s-]?expression\b/g, "oe")
  x = x.replace(/\bwild[\s-]?type\b/g, "wt")
  x = x.replace(/\s+/g, " ").trim()
  return x
}

/** All arm labels from `A/B; C/D` contrasts (+ segment text). */
function conditionGroupNameTokens(raw: string): string[] {
  const out = new Set<string>()
  for (const segment of splitMultiLabel(raw)) {
    const seg = softenConditionArm(segment)
    if (seg) out.add(seg)
    for (const arm of segment.split("/")) {
      const name = softenConditionArm(arm)
      if (name) out.add(name)
      for (const w of significantWords(name, 3)) out.add(w)
    }
  }
  return [...out].sort()
}

function tokensMatchLoose(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const min = 2
  if (a.length >= min && b.length >= min && (a.includes(b) || b.includes(a))) return true
  const wa = significantWords(a, 3)
  const wb = significantWords(b, 3)
  for (const x of wa) {
    for (const y of wb) {
      if (x === y) return true
      if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return true
    }
  }
  return false
}

/** Token-set F1 with loose token pairing (condition / sample vs long pred text). */
function setF1LooseFromTokenLists(goldTokens: string[], predTokens: string[]): number {
  const g = [...new Set(goldTokens.filter(Boolean))]
  const p = [...new Set(predTokens.filter(Boolean))]
  if (g.length === 0 && p.length === 0) return 1
  if (g.length === 0 || p.length === 0) return 0
  let goldHit = 0
  for (const gt of g) {
    if (p.some((pt) => gt === pt || tokensMatchLoose(gt, pt))) goldHit++
  }
  let predHit = 0
  for (const pt of p) {
    if (g.some((gt) => pt === gt || tokensMatchLoose(gt, pt))) predHit++
  }
  const prec = predHit / p.length
  const rec = goldHit / g.length
  if (prec + rec === 0) return 0
  return (2 * prec * rec) / (prec + rec)
}

function predConditionText(pred: LiteratureInfoRow): string {
  return [pred.condition, pred.detailCondition].filter(Boolean).join(" ; ")
}

function predSampleText(pred: LiteratureInfoRow): string {
  return [pred.sample, pred.conditionSampleMap].filter(Boolean).join(" ; ")
}

/**
 * Lenient 0/1 per paper: any gold arm/name/word hits pred text or tokens.
 * Pred may use condition/detailCondition or sample/conditionSampleMap (Stage 5 fills gaps).
 */
function relaxedFieldHitScore(
  goldRaw: string,
  predRaw: string,
  tokenFn: (s: string) => string[],
): number {
  const goldNorm = normLooseText(goldRaw)
  if (!goldNorm) return 1
  const predNorm = normLooseText(predRaw)
  if (!predNorm) return 0

  const goldTokens = tokenFn(goldRaw)
  const predTokens = tokenFn(predRaw)

  for (const x of goldTokens) {
    if (x.length < 2) continue
    if (predNorm.includes(x)) return 1
    for (const y of predTokens) {
      if (tokensMatchLoose(x, y)) return 1
    }
  }

  for (const segment of splitMultiLabel(goldRaw)) {
    for (const arm of segment.split("/")) {
      const softened = softenConditionArm(arm)
      if (softened.length >= 3 && predNorm.includes(softened)) return 1
      for (const w of significantWords(arm, 4)) {
        if (predNorm.includes(w)) return 1
      }
    }
  }

  for (const part of splitSampleParts(goldRaw)) {
    if (part.length >= 3 && predNorm.includes(part)) return 1
    for (const w of significantWords(part, 4)) {
      if (predNorm.includes(w)) return 1
    }
  }

  return 0
}

function sampleTypeTokens(raw: string): string[] {
  return splitMultiLabel(raw).map((t) => normWs(t).toLowerCase()).filter(Boolean).sort()
}

function normEnrichmentToken(t: string): string {
  let x = sanitizeGoldMSFields(t).toLowerCase()
  if (/fe[\s³3._-]*nta|high-select fe|ni-nta.*fe|nta.*fe-nta/i.test(x)) return "fe-nta"
  if (/tio2|tio__|titansphere|phos-tio|high-select tio/i.test(x)) return "tio2"
  if (/fe-imac|imac|simac|moac/i.test(x)) return "imac"
  if (/zic-hilic|sax-hilic|\bhilic\b|hilic spe/i.test(x)) return "hilic"
  if (/anti-?di\s?gly|digly|k-ε-gg|k-gg/i.test(x)) return "anti-digly"
  if (/anti-?k-?(?:ε|e)-?gg/i.test(x)) return "anti-k-gg"
  if (/anti-?acetyl|anti-k-ac|ac-k kit|ptmscan ac-k|ac-k\]/i.test(x)) return "anti-acetyl"
  if (/anti-?ub/i.test(x)) return "anti-ubiquitin"
  if (/unenriched|no enrichment|none/i.test(x)) return "none"
  return x.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim()
}

const ENRICHMENT_FAMILY_PATTERNS: Array<[string, RegExp]> = [
  ["tio2", /tio2|titansphere|phos-tio|high-select tio/i],
  ["fe-nta", /fe-nta|fe nta|nti-nta|fe\(iii\)/i],
  ["imac", /imac|fe-imac|simac|moac/i],
  ["hilic", /hilic|zic-hilic|sax-hilic/i],
  ["anti-acetyl", /anti-acetyl|anti-k-ac|ac-k kit|ptmscan ac-k|ac-k\]/i],
  ["anti-digly", /anti-digly|di.?gly|k-gg/i],
  ["anti-k-gg", /anti-k-gg|k-ε-gg/i],
  ["none", /unenriched|no enrichment|^none$/i],
]

function enrichmentFamilyTokens(raw: string): string[] {
  const out = new Set<string>()
  const s = sanitizeGoldMSFields(raw).toLowerCase()
  for (const t of enrichmentTokens(raw)) {
    out.add(t)
    for (const [fam, re] of ENRICHMENT_FAMILY_PATTERNS) {
      if (re.test(t)) out.add(fam)
    }
  }
  for (const [fam, re] of ENRICHMENT_FAMILY_PATTERNS) {
    if (re.test(s)) out.add(fam)
  }
  return [...out].sort()
}

function enrichmentTokens(raw: string): string[] {
  return splitMultiLabel(raw, { allowComma: true }).map(normEnrichmentToken).filter(Boolean).sort()
}

function enrichmentRelaxedScore(gold: ManualGoldRow, pred: LiteratureInfoRow): number {
  const hit = relaxedFieldHitScore(
    gold.enrichmentMethod,
    pred.enrichmentMethod,
    enrichmentFamilyTokens,
  )
  if (hit >= 1) return 1
  const f1 = setF1FromTokenLists(
    enrichmentFamilyTokens(gold.enrichmentMethod),
    enrichmentFamilyTokens(pred.enrichmentMethod),
  )
  return f1 >= 0.5 ? 1 : 0
}

function ptmTokens(raw: string): string[] {
  return splitMultiLabel(raw, { allowComma: true })
    .map((t) => normWs(t).toLowerCase())
    .filter(Boolean)
    .sort()
}

/** Instrument models (vendor text stripped); longest patterns first to avoid double-counting. */
const MS_MODEL_PATTERNS: Array<[string, RegExp]> = [
  ["orbitrap fusion lumos", /orbitrap\s+fusion\s+lumos/i],
  ["orbitrap fusion tribrid", /orbitrap\s+fusion\s+tribrid/i],
  ["orbitrap fusion", /orbitrap\s+fusion(?!(\s+lumos|\s+tribrid))/i],
  ["orbitrap eclipse", /orbitrap\s+eclipse/i],
  ["orbitrap exploris 480", /(?:orbitrap\s+)?exploris\s+480/i],
  ["q exactive hf-x", /q[\s-]?exactive\s+hf[\s-]?x/i],
  ["q exactive hf", /q[\s-]?exactive\s+hf(?!-x)/i],
  ["q exactive plus", /q[\s-]?exactive\s+plus/i],
  ["q exactive", /q[\s-]?exactive(?!(\s+hf|\s+plus))/i],
  ["tims tof pro", /4d\s+tims?tof\s+pro|tims?tof\s+pro/i],
  ["tims tof", /tims[\s-]?tof|tims\s+tof/i],
  ["orbitrap velos", /orbitrap\s+velos|ltq\s+velos/i],
  ["orbitrap elite", /orbitrap\s+elite/i],
  ["orbitrap xl", /orbitrap\s+xl|ltq\s+orbitrap\s+xl/i],
  ["evosep exploris 480", /evosep[\s\S]{0,40}exploris\s+480/i],
]

function massSpectrometerTokens(raw: string): string[] {
  const chunks = sanitizeGoldMSFields(raw)
    .split(/\band\b|;/i)
    .flatMap((c) => splitMultiLabel(c, { allowComma: true }))
  const found = new Set<string>()
  for (const chunk of chunks) {
    const u = normWs(chunk)
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/thermo[\s-]*fisher[\s\S]*/i, " ")
    if (!u.trim()) continue
    let matched = false
    for (const [name, re] of MS_MODEL_PATTERNS) {
      if (re.test(u)) {
        found.add(name)
        matched = true
      }
    }
    if (!matched) {
      const fb = u.replace(/\s+/g, " ").trim().slice(0, 80)
      if (fb) found.add(fb)
    }
  }
  return [...found].sort()
}

function massSpectrometerRelaxedScore(gold: ManualGoldRow, pred: LiteratureInfoRow): number {
  const gRaw = sanitizeGoldMSFields(gold.massSpectrometer)
  const pRaw = sanitizeGoldMSFields(pred.massSpectrometer)
  if (!gRaw.trim()) return 1
  if (!pRaw.trim()) return 0
  const gModels = massSpectrometerTokens(gRaw)
  const pModels = massSpectrometerTokens(pRaw)
  const pNorm = normLooseText(pRaw)
  for (const g of gModels) {
    if (pModels.includes(g)) return 1
    if (g.length >= 6 && pNorm.includes(g)) return 1
  }
  for (const g of gModels) {
    for (const p of pModels) {
      if (tokensMatchLoose(g, p)) return 1
    }
  }
  const f1 = setF1FromTokenLists(gModels, pModels)
  return f1 >= 0.5 ? 1 : 0
}

type MetaFieldKind =
  | "identifier"
  | "msDataSource"
  | "labelMethod"
  | "sampleType"
  | "organism"
  | "enrichmentMethod"
  | "massSpectrometer"
  | "ptms"

function tokensForField(raw: string, kind: MetaFieldKind): string[] {
  switch (kind) {
    case "identifier":
      return identifierTokens(raw)
    case "msDataSource":
      return msSourceTokens(raw)
    case "labelMethod":
      return labelMethodTokens(raw)
    case "sampleType":
      return sampleTypeTokens(raw)
    case "organism":
      return organismTokens(raw)
    case "enrichmentMethod":
      return enrichmentTokens(raw)
    case "massSpectrometer":
      return massSpectrometerTokens(raw)
    case "ptms":
      return ptmTokens(raw)
  }
}

function fieldF1(gold: string, pred: string, kind: MetaFieldKind): number {
  return setF1FromTokenLists(tokensForField(gold, kind), tokensForField(pred, kind))
}

/** Multi-value field: correct (1) if any gold label/token matches any predicted label/token. */
function anyLabelAccuracy(goldTokens: string[], predTokens: string[], loose = false): number {
  const g = [...new Set(goldTokens.filter(Boolean))]
  if (g.length === 0) return 1
  const p = [...new Set(predTokens.filter(Boolean))]
  if (p.length === 0) return 0
  for (const gt of g) {
    for (const pt of p) {
      if (gt === pt || (loose && tokensMatchLoose(gt, pt))) return 1
    }
  }
  return 0
}

function fieldAccuracy(gold: string, pred: string, kind: MetaFieldKind, loose = false): number {
  return anyLabelAccuracy(tokensForField(gold, kind), tokensForField(pred, kind), loose)
}

/** Per-field accuracy (0/1 per paper); macro mean reported as macroAccuracy. */
function scoreMeta(gold: ManualGoldRow, pred: LiteratureInfoRow) {
  return {
    identifier: identifierRelaxedScore(gold, pred),
    msDataSource: fieldAccuracy(gold.msDataSource, pred.msDataSource, "msDataSource"),
    labelMethod: anyLabelAccuracy(
      labelMethodTokensExpanded(gold.labelMethod),
      labelMethodTokensExpanded(pred.labelMethod),
    ),
    sampleType: fieldAccuracy(gold.sampleType, pred.sampleType, "sampleType"),
    organism: fieldAccuracy(gold.organism, pred.organism, "organism"),
    sample: relaxedFieldHitScore(gold.sample, predSampleText(pred), sampleNameTokens),
    enrichmentMethod: enrichmentRelaxedScore(gold, pred),
    massSpectrometer: massSpectrometerRelaxedScore(gold, pred),
    ptms: fieldAccuracy(gold.ptms, pred.ptms, "ptms"),
    condition: relaxedFieldHitScore(
      gold.condition,
      predConditionText(pred),
      conditionGroupNameTokens,
    ),
  }
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

async function runStage1(
  gold: ManualGoldRow[],
  concurrency: number,
): Promise<Record<string, unknown>> {
  const pmids = gold.map((g) => g.pmid)
  console.log(`[stage1] Resolving abstracts for ${pmids.length} PMIDs…`)
  const resolved = await resolveAbstractsForPmids(pmids, {
    cache: true,
    onProgress: (m) => console.log(`[stage1] ${m}`),
  })
  if (resolved.missing.length) {
    console.warn(`[stage1] Missing abstract for: ${resolved.missing.join(", ")}`)
  }
  const byPmid = new Map(resolved.records.map((r) => [r.pmid, r]))
  const runtime = await createLlmRuntime({})
  const chain = new ScreenChain(runtime)

  const results: Array<{
    pmid: string
    decision: string
    confidence: number
  }> = []

  let idx = 0
  async function worker() {
    while (idx < gold.length) {
      const i = idx++
      const g = gold[i]
      const abs = byPmid.get(g.pmid)
      const title = abs?.title || g.title
      const abstract = abs?.abstract || g.detailCondition || ""
      if (!abstract.trim()) {
        results.push({ pmid: g.pmid, decision: "error_no_abstract", confidence: 0 })
        continue
      }
      try {
        const out = await chain.run({
          pmid: g.pmid,
          title,
          abstract,
          sourceFile: "eval-m109",
        })
        results.push({ pmid: g.pmid, decision: out.decision, confidence: out.confidence })
        console.log(`[stage1] ${i + 1}/${gold.length} ${g.pmid} → ${out.decision}`)
      } catch (err) {
        results.push({ pmid: g.pmid, decision: "error", confidence: 0 })
        console.error(`[stage1] ${g.pmid} failed:`, err)
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, gold.length))
  await Promise.all(Array.from({ length: n }, () => worker()))

  const include = results.filter((r) => r.decision === "include").length
  const uncertain = results.filter((r) => r.decision === "uncertain").length
  const exclude = results.filter((r) => r.decision === "exclude").length
  const errors = results.filter((r) => r.decision.startsWith("error")).length

  return {
    modelId: runtime.modelId,
    n: gold.length,
    include,
    uncertain,
    exclude,
    errors,
    recallInclude: include / gold.length,
    uncertainRate: uncertain / gold.length,
    falseExclusionRate: exclude / gold.length,
    perPmid: results,
  }
}

async function runStage3Test(
  goldByPmid: Map<string, ManualGoldRow>,
  testPmids: string[],
  concurrency: number,
): Promise<Record<string, unknown>> {
  console.log(`[stage3] Resolving abstracts for ${testPmids.length} test PMIDs…`)
  const resolved = await resolveAbstractsForPmids(testPmids, { cache: true })
  const absMap = new Map(resolved.records.map((r) => [r.pmid, r]))
  const discover = loadDiscoverByPmid()
  const runtime = await createLlmRuntime({})
  const chain = new MetaChain(runtime)

  const preds: Array<{ pmid: string; row?: LiteratureInfoRow; error?: string; textSource?: string }> = []
  let idx = 0

  async function worker() {
    while (idx < testPmids.length) {
      const i = idx++
      const pmid = testPmids[i]
      const g = goldByPmid.get(pmid)!
      const absRec = absMap.get(pmid)
      const title = absRec?.title || g.title
      const abstract = absRec?.abstract || g.detailCondition || ""
      try {
        const excerpt = await loadFulltextExcerpt(pmid, abstract)
        if (!excerpt.excerpt.trim()) {
          preds.push({ pmid, error: "no extractable text", textSource: excerpt.textSource })
          continue
        }
        const repos = (discover.get(pmid)?.repositories ?? []).map((r) => ({
          id: r.id,
          source: r.source,
          via: r.via,
        }))
        const knownIdentifiers = selectKnownIdentifiersForMeta(repos, excerpt.excerpt)
        const row = await chain.run({
          pmid,
          title,
          excerpt: excerpt.excerpt,
          textSource: excerpt.textSource,
          knownIdentifiers,
        })
        preds.push({ pmid, row, textSource: excerpt.textSource })
        console.log(`[stage3] ${i + 1}/${testPmids.length} ${pmid} ok (${excerpt.textSource})`)
      } catch (err) {
        preds.push({ pmid, error: err instanceof Error ? err.message : String(err) })
        console.error(`[stage3] ${pmid} failed:`, err)
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, testPmids.length))
  await Promise.all(Array.from({ length: n }, () => worker()))

  return {
    ...aggregateStage3Scores(preds, goldByPmid, { modelId: runtime.modelId, testN: testPmids.length }),
  }
}

function aggregateStage3Scores(
  preds: Array<{ pmid: string; row?: LiteratureInfoRow; error?: string; textSource?: string }>,
  goldByPmid: Map<string, ManualGoldRow>,
  meta: { modelId?: string; testN: number },
) {
  const scored = preds
    .filter((p) => p.row)
    .map((p) => ({
      pmid: p.pmid,
      textSource: p.textSource,
      scores: scoreMeta(goldByPmid.get(p.pmid)!, p.row!),
    }))

  type FieldKey =
    | "identifier"
    | "msDataSource"
    | "labelMethod"
    | "sampleType"
    | "organism"
    | "sample"
    | "enrichmentMethod"
    | "massSpectrometer"
    | "ptms"
    | "condition"
  const macroAcc = (key: FieldKey) =>
    scored.length ? mean(scored.map((s) => s.scores[key] as number)) : 0

  const macroAccuracy = {
    identifier: macroAcc("identifier"),
    msDataSource: macroAcc("msDataSource"),
    labelMethod: macroAcc("labelMethod"),
    sampleType: macroAcc("sampleType"),
    organism: macroAcc("organism"),
    sample: macroAcc("sample"),
    enrichmentMethod: macroAcc("enrichmentMethod"),
    massSpectrometer: macroAcc("massSpectrometer"),
    ptms: macroAcc("ptms"),
    condition: macroAcc("condition"),
  }

  return {
    modelId: meta.modelId ?? "rescore",
    testN: meta.testN,
    scoredN: scored.length,
    errors: preds.filter((p) => p.error).length,
    evalMetric:
      "macroAccuracy: per paper 0/1 if any gold label/token matches prediction (multi-label any-hit); mean over test set.",
    macroAccuracy,
    macroF1: macroAccuracy,
    perPmid: preds,
    scored,
  }
}

function rescoreMetaResultFile(
  resultPath: string,
  goldByPmid: Map<string, ManualGoldRow>,
): Record<string, unknown> {
  const prior = JSON.parse(readFileSync(resultPath, "utf8")) as {
    modelId?: string
    testN?: number
    perPmid?: Array<{ pmid: string; row?: LiteratureInfoRow; error?: string; textSource?: string }>
  }
  const preds = prior.perPmid ?? []
  return aggregateStage3Scores(preds, goldByPmid, {
    modelId: prior.modelId,
    testN: prior.testN ?? preds.length,
  })
}

async function main(): Promise<void> {
  loadDotEnv()
  const args = process.argv.slice(2)
  const stage1Only = args.includes("--stage1-only")
  const stage3Only = args.includes("--stage3-only")
  const rescorePath = args.find((a) => a.startsWith("--rescore="))?.split("=")[1]
  const concurrency = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 2)

  mkdirSync(SPLITS_DIR, { recursive: true })
  mkdirSync(RESULTS_DIR, { recursive: true })

  const gold = loadManualGold()
  const goldByPmid = new Map(gold.map((g) => [g.pmid, g]))
  const split = buildM109Split(gold)

  if (rescorePath) {
    const abs = rescorePath.startsWith("/") ? rescorePath : join(projectRoot(), rescorePath)
    const s3 = rescoreMetaResultFile(abs, goldByPmid)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const out = join(RESULTS_DIR, `meta_m109_test_rescore_${stamp}.json`)
    writeFileSync(out, JSON.stringify(s3, null, 2))
    const a = s3.macroF1 as Record<string, number>
    console.log(`[rescore] from ${abs}`)
    console.log(JSON.stringify(a, null, 2))
    console.log(`[rescore] written ${out}`)
    return
  }

  writeFileSync(join(SPLITS_DIR, "m109_pmids.json"), JSON.stringify({ pmids: split.allPmids }, null, 2))
  writeFileSync(
    join(SPLITS_DIR, "m109_fewshot_exclude.json"),
    JSON.stringify({ pmids: split.fewshotExclude }, null, 2),
  )
  writeFileSync(
    join(SPLITS_DIR, "m109_meta_split.json"),
    JSON.stringify(
      {
        seed: SPLIT_SEED,
        testFraction: TEST_FRACTION,
        dev: split.dev,
        test: split.test,
      },
      null,
      2,
    ),
  )
  console.log(`M109: ${gold.length} papers | test=${split.test.length} dev=${split.dev.length}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")

  if (!stage3Only) {
    const s1 = await runStage1(gold, concurrency)
    const path = join(RESULTS_DIR, `screen_m109_${stamp}.json`)
    writeFileSync(path, JSON.stringify(s1, null, 2))
    console.log(`\n[stage1] Recall@include: ${((s1.recallInclude as number) * 100).toFixed(1)}% (${s1.include}/${s1.n})`)
    console.log(`[stage1] written ${path}`)
  }

  if (!stage1Only) {
    const pmidsArg = args.find((a) => a.startsWith("--pmids="))?.split("=")[1]
    const stage3Pmids = pmidsArg
      ? pmidsArg
          .split(/[,;\s]+/)
          .map((p) => p.trim())
          .filter((p) => /^\d+$/.test(p))
      : split.test
    if (pmidsArg && stage3Pmids.length === 0) {
      throw new Error("--pmids= had no valid PMIDs")
    }
    const s3 = await runStage3Test(goldByPmid, stage3Pmids, concurrency)
    const path = join(RESULTS_DIR, `meta_m109_test_${stamp}.json`)
    writeFileSync(path, JSON.stringify(s3, null, 2))
    const a = s3.macroF1 as Record<string, number>
    console.log(`\n[stage3] test n=${s3.scoredN}/${s3.testN}`)
    console.log(
      `[stage3] macro-F1 identifier=${(a.identifier * 100).toFixed(1)}% msDataSource=${(a.msDataSource * 100).toFixed(1)}% ` +
        `organism=${(a.organism * 100).toFixed(1)}% sample(any-hit)=${(a.sample * 100).toFixed(1)}% ` +
        `condition(any-hit)=${(a.condition * 100).toFixed(1)}%`,
    )
    console.log(`[stage3] written ${path}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
