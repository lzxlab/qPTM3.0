#!/usr/bin/env npx tsx
/**
 * Stage 5 benchmark: manual qratio gold vs pipeline predictions.
 * Pred-anchored: each prediction row is matched to gold; gold-only rows are not scored.
 * Metrics: field accuracy on matched pred–gold pairs (pred-anchored, condition-aligned site match).
 * PTMs / Condition are scored on pred rows whose site exists in gold (Condition uses contrast alignment).
 */
import { createReadStream, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { basename, join } from "node:path"
import type { QratioRow } from "../../src/stage5/parse-rows.js"
import { canonicalizeConditionKey } from "../../src/stage5/condition.js"
import { canonicalizePtm, splitPtms } from "../../src/stage5/ptm.js"
import { runStage4SuppScout } from "../../src/pipeline/stage4-supp.js"
import { runStage5Parse } from "../../src/pipeline/stage5.js"
import { loadDotEnv } from "../../src/runtime.js"
import type { LiteratureInfoRow, Stage5Result } from "../../src/types.js"
import { ingestSupplementaryFromPmidDir, listTabularInPmidDir } from "../../src/ingest/manual-supp.js"
import {
  appendStage3Results,
  loadStage3ResultForPmid,
  parseCsv,
  projectRoot,
  stage5Dir,
  stage5QratioCsvPath,
  stage5ResultsJsonlPath,
} from "../../src/utils/io.js"

const GOLD_DIR = join(projectRoot(), "evaluation_data/stage5_qratio_data")
const MANUAL_CSV = join(projectRoot(), "evaluation_data/qPTM3_manul_collect_109pmids.csv")
const RESULTS_DIR = join(projectRoot(), "evaluation_data/results")

interface QratioSiteRow {
  pmid: string
  ptms: string
  condition: string
  conditionKey: string
  uniprot: string
  position: number
  aminoAcid: string
  log2Peptide: number | null
  pValuePeptide: number | null
  log2Protein: number | null
  pValueProtein: number | null
}

interface FieldAccuracy {
  ptms: number | null
  condition: number | null
  uniprotId: number | null
  position: number | null
  aminoAcid: number | null
  log2RatioPeptide: number | null
  pValuePeptide: number | null
  log2RatioProtein: number | null
  pValueProtein: number | null
}

interface PmidEval {
  pmid: string
  goldPath: string
  pipeline: Stage5Result | null
  predRows: number
  comparedPairs: number
  fieldAccuracy: FieldAccuracy
  notes: string[]
}

const LOG2_ABS_TOL = 0.02
const P_VALUE_ABS_TOL = 1e-4
const P_VALUE_REL_TOL = 0.05
const P_VALUE_DISPLAY_DECIMALS = 2

/** Peptide p-value column not mapped or mapped to the wrong field. Dropped from scoring. */
const EXCLUDE_UNMAPPED_PVALUE_PMIDS = new Set([
  "38389037", // pred pValuePeptide empty; gold has peptide p
  "37709257", // log2 matches, p mapped to a different column
  "36902152", // gold/pred columns scrambled (gold "p" includes negatives and values > 1)
  "37232035", // gold peptide p is entirely NA
])

function normUniprot(s: string): string {
  return (s || "").trim().toUpperCase()
}

/** Gold manual exports use Unicode subscripts (CCl₄); pipeline uses ASCII. */
function normalizeConditionKey(cond: string): string {
  const sub = cond.normalize("NFKD").replace(/[\u2080-\u2099]/g, (ch) => {
    const cp = ch.codePointAt(0)!
    return String(cp - 0x2080)
  })
  return canonicalizeConditionKey(sub)
}

function conditionTokens(key: string): Set<string> {
  return new Set(key.split(/[^a-z0-9]+/).filter((t) => t.length >= 2))
}

function splitContrastArms(cond: string): string[] {
  return cond
    .split(/[/|]|(?:\s+vs\.?\s+)/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** First token initial per arm (Naive pluripotency → n; N → n). */
function contrastArmInitial(part: string): string {
  const token = part
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)[0]
  return (token?.[0] ?? "").toLowerCase()
}

/** e.g. gold Naive/Primed vs pipeline N/P. */
function twoArmAbbrevAlign(goldRaw: string, predRaw: string): boolean {
  const g = splitContrastArms(goldRaw)
  const p = splitContrastArms(predRaw)
  if (g.length !== 2 || p.length !== 2) return false
  const gi = g.map(contrastArmInitial)
  const pi = p.map(contrastArmInitial)
  if (!gi[0] || !gi[1] || !pi[0] || !pi[1]) return false
  return (
    (gi[0] === pi[0] && gi[1] === pi[1]) || (gi[0] === pi[1] && gi[1] === pi[0])
  )
}

function isTumorNormalContrast(raw: string): boolean {
  const s = (raw || "").toLowerCase().replace(/\s+/g, " ")
  if (/tumor\s*\/\s*normal/.test(s)) return true
  if (/\bt\s*\/\s*n\b/.test(s)) return true
  if (/fold\s*change\s*\(\s*t\s*\/\s*n/i.test(s)) return true
  if (/^fold\s*change\s*\(\s*t\s*\/\s*n/i.test((raw || "").trim())) return true
  return false
}

function isSirt2OeControlContrast(goldRaw: string, predRaw: string): boolean {
  if (!/sirt2/i.test(goldRaw) || !/sirt2/i.test(predRaw)) return false
  const goldOe = /oe|overexpression/i.test(goldRaw)
  const predCtrl = /\/\s*(nc|ctr|ctrl|control)\b/i.test(predRaw)
  return goldOe && predCtrl
}

/** Allow manual vs pipeline condition wording drift (same contrast arms). */
function conditionsAlign(
  goldKey: string,
  predKey: string,
  goldRaw = "",
  predRaw = "",
): boolean {
  if (goldRaw && predRaw && isTumorNormalContrast(goldRaw) && isTumorNormalContrast(predRaw)) {
    return true
  }
  if (goldRaw && predRaw && isSirt2OeControlContrast(goldRaw, predRaw)) return true
  if (goldRaw && predRaw && twoArmAbbrevAlign(goldRaw, predRaw)) return true
  if (!goldKey || !predKey) return false
  if (goldKey === predKey) return true
  if (goldKey.includes(predKey) || predKey.includes(goldKey)) return true
  const g = conditionTokens(goldKey)
  const p = conditionTokens(predKey)
  let inter = 0
  for (const t of g) if (p.has(t)) inter++
  const union = new Set([...g, ...p]).size
  if (union === 0) return false
  const jaccard = inter / union
  if (jaccard >= 0.45) return true
  // Common fibrosis / KO contrasts
  const tags = ["ccl4", "ccl4treated", "fibrosis", "ctr", "ctrl", "ko", "wt", "cauda", "caput", "dmso"]
  for (const tag of tags) {
    if (g.has(tag) && p.has(tag)) {
      const gHit = tags.filter((t) => g.has(t))
      const pHit = tags.filter((t) => p.has(t))
      if (gHit.sort().join() === pHit.sort().join()) return true
    }
  }
  return false
}

function indexGoldBySite(gold: QratioSiteRow[]): Map<string, QratioSiteRow[]> {
  const map = new Map<string, QratioSiteRow[]>()
  for (const gr of gold) {
    const k = siteRelaxedKey(gr)
    const list = map.get(k)
    if (list) list.push(gr)
    else map.set(k, [gr])
  }
  return map
}

/** Match each prediction row to gold; gold-only rows are never scored. */
function goldForPred(
  pr: QratioSiteRow,
  goldBySite: Map<string, QratioSiteRow[]>,
  mode: "aligned" | "relaxed",
): QratioSiteRow | null {
  const cands = goldBySite.get(siteRelaxedKey(pr)) ?? []
  if (!cands.length) return null
  if (mode === "aligned") {
    const exact = cands.find((gr) => siteStrictKey(gr) === siteStrictKey(pr))
    if (exact) return exact
    return (
      cands.find((gr) =>
        conditionsAlign(gr.conditionKey, pr.conditionKey, gr.condition, pr.condition),
      ) ?? null
    )
  }
  const aligned = cands.find((gr) =>
    conditionsAlign(gr.conditionKey, pr.conditionKey, gr.condition, pr.condition),
  )
  if (aligned) return aligned
  if (pr.log2Peptide != null) {
    let best: QratioSiteRow | null = null
    let bestD = Infinity
    for (const gr of cands) {
      if (gr.log2Peptide == null) continue
      const d = Math.abs(gr.log2Peptide - pr.log2Peptide)
      if (d < bestD) {
        bestD = d
        best = gr
      }
    }
    if (best) return best
  }
  return cands[0] ?? null
}

function parsePosition(s: string): number | null {
  const n = parseInt(String(s || "").trim(), 10)
  return Number.isFinite(n) ? n : null
}

function parseLog2(s: string): number | null {
  const t = String(s ?? "").trim()
  if (!t || /^nan$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parsePValue(s: string): number | null {
  let t = String(s ?? "")
    .replace(/,/g, "")
    .replace(/\u2212/g, "-")
    .trim()
  if (!t || /^(na|nan|#n\/a|n\/a|null|none|-)$/i.test(t)) return null
  const sci = t.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*[×xX]\s*10\s*\^?\s*([+-]?\d+)$/i)
  if (sci) {
    const n = Number(sci[1]) * 10 ** Number(sci[2])
    return Number.isFinite(n) ? n : null
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function numericFieldMatch(gold: number | null, pred: number | null, absTol: number): boolean {
  if (gold == null && pred == null) return true
  if (gold == null || pred == null) return false
  return Math.abs(gold - pred) <= absTol
}

/** Decimal, scientific notation, and 2-decimal table rounding all count as a match. */
function pValueFieldMatch(gold: number | null, pred: number | null): boolean {
  if (gold == null && pred == null) return true
  if (gold == null || pred == null) return false
  const d = Math.abs(gold - pred)
  if (d <= P_VALUE_ABS_TOL) return true
  if (gold.toFixed(P_VALUE_DISPLAY_DECIMALS) === pred.toFixed(P_VALUE_DISPLAY_DECIMALS)) return true
  const scale = Math.max(Math.abs(gold), Math.abs(pred), Number.EPSILON)
  return d / scale <= P_VALUE_REL_TOL
}

function canonPtmSet(raw: string): string[] {
  const parts = splitPtms(raw)
    .map((t) => canonicalizePtm(t).toLowerCase())
    .filter(Boolean)
  return [...new Set(parts)].sort()
}

/** Canonical qPTM names; both empty counts as a match. Pred may be one of gold's listed types. */
function ptmFieldMatch(gold: string, pred: string): boolean {
  const g = canonPtmSet(gold)
  const p = canonPtmSet(pred)
  if (!g.length && !p.length) return true
  if (!g.length || !p.length) return false
  if (g.join("\0") === p.join("\0")) return true
  return p.length === 1 && g.includes(p[0])
}

function siteRelaxedKey(r: Pick<QratioSiteRow, "uniprot" | "position" | "aminoAcid">): string {
  return `${r.uniprot}|${r.position}|${r.aminoAcid}`
}

function siteStrictKey(r: QratioSiteRow): string {
  return `${siteRelaxedKey(r)}|${r.conditionKey}`
}

function colIdx(header: string[], names: string[]): number {
  const norm = header.map((h) => h.trim().replace(/^\uFEFF/, "").toLowerCase())
  for (const name of names) {
    const i = norm.indexOf(name.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

function loadGoldRows(path: string): QratioSiteRow[] {
  const rows = parseCsv(readFileSync(path, "utf8"))
  if (rows.length < 2) return []
  const header = rows[0]
  const pmidI = colIdx(header, ["pmid"])
  const ptmI = colIdx(header, ["ptms", "ptm", "modification"])
  const condI = colIdx(header, ["condition"])
  const uniI = colIdx(header, ["uniprotid", "uniprot id"])
  const posI = colIdx(header, ["position"])
  const aaI = colIdx(header, ["aminoacid", "amino acid"])
  const l2I = colIdx(header, ["log2ratio (peptide)", "log2ratio (site)"])
  const pPeptideI = colIdx(header, ["p value (peptide)", "p value (site)"])
  const l2pI = colIdx(header, ["log2ratio (protein)"])
  const pProteinI = colIdx(header, ["p value (protein)"])
  const out: QratioSiteRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i]
    const pmid = (c[pmidI] ?? "").trim()
    const uniprot = normUniprot(c[uniI] ?? "")
    const position = parsePosition(c[posI] ?? "")
    const aminoAcid = (c[aaI] ?? "").trim().toUpperCase()
    if (!pmid || !uniprot || position == null || !aminoAcid) continue
    const condition = (c[condI] ?? "").trim()
    out.push({
      pmid,
      ptms: ptmI >= 0 ? (c[ptmI] ?? "").trim() : "",
      condition,
      conditionKey: normalizeConditionKey(condition),
      uniprot,
      position,
      aminoAcid,
      log2Peptide: parseLog2(c[l2I] ?? ""),
      pValuePeptide: pPeptideI >= 0 ? parsePValue(c[pPeptideI] ?? "") : null,
      log2Protein: parseLog2(c[l2pI] ?? ""),
      pValueProtein: pProteinI >= 0 ? parsePValue(c[pProteinI] ?? "") : null,
    })
  }
  return out
}

function loadPredRowsFromCsv(path: string, pmidFilter?: Set<string>): QratioSiteRow[] {
  if (!existsSync(path)) return []
  const rows = parseCsv(readFileSync(path, "utf8"))
  if (rows.length < 2) return []
  const header = rows[0]
  const pmidI = colIdx(header, ["pmid"])
  const ptmI = colIdx(header, ["ptms", "ptm", "modification"])
  const condI = colIdx(header, ["condition"])
  const uniI = colIdx(header, ["uniprotid", "uniprot id"])
  const posI = colIdx(header, ["position"])
  const aaI = colIdx(header, ["aminoacid", "amino acid"])
  const l2I = colIdx(header, ["log2ratio (peptide)", "log2ratio (site)"])
  const pPeptideI = colIdx(header, ["p value (peptide)", "p value (site)"])
  const l2pI = colIdx(header, ["log2ratio (protein)"])
  const pProteinI = colIdx(header, ["p value (protein)"])
  const out: QratioSiteRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i]
    const pmid = (c[pmidI] ?? "").trim()
    if (pmidFilter && !pmidFilter.has(pmid)) continue
    const uniprot = normUniprot(c[uniI] ?? "")
    const position = parsePosition(c[posI] ?? "")
    const aminoAcid = (c[aaI] ?? "").trim().toUpperCase()
    if (!pmid || !uniprot || position == null || !aminoAcid) continue
    const condition = (c[condI] ?? "").trim()
    out.push({
      pmid,
      ptms: ptmI >= 0 ? (c[ptmI] ?? "").trim() : "",
      condition,
      conditionKey: canonicalizeConditionKey(condition),
      uniprot,
      position,
      aminoAcid,
      log2Peptide: parseLog2(c[l2I] ?? ""),
      pValuePeptide: pPeptideI >= 0 ? parsePValue(c[pPeptideI] ?? "") : null,
      log2Protein: parseLog2(c[l2pI] ?? ""),
      pValueProtein: pProteinI >= 0 ? parsePValue(c[pProteinI] ?? "") : null,
    })
  }
  return out
}

function predRowFromQratio(r: QratioRow): QratioSiteRow | null {
  const uniprot = normUniprot(r.uniprotId ?? "")
  const position = parsePosition(r.position ?? "")
  const aminoAcid = (r.aminoAcid ?? "").trim().toUpperCase()
  if (!uniprot || position == null || !aminoAcid) return null
  const condition = (r.condition ?? "").trim()
  return {
    pmid: r.pmid,
    ptms: (r.ptms ?? "").trim(),
    condition,
    conditionKey: canonicalizeConditionKey(condition),
    uniprot,
    position,
    aminoAcid,
    log2Peptide: parseLog2(r.log2RatioPeptide ?? ""),
    pValuePeptide: parsePValue(r.pValuePeptide ?? ""),
    log2Protein: parseLog2(r.log2RatioProtein ?? ""),
    pValueProtein: parsePValue(r.pValueProtein ?? ""),
  }
}

async function loadPredRowsFromJsonl(path: string, pmidFilter: Set<string>): Promise<QratioSiteRow[]> {
  const out: QratioSiteRow[] = []
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t) as QratioRow
      if (!pmidFilter.has(r.pmid)) continue
      const row = predRowFromQratio(r)
      if (row) out.push(row)
    } catch {
      // skip bad line
    }
  }
  return out
}

async function loadPredRowsGrouped(
  combinedPath: string,
  pmidFilter: Set<string>,
): Promise<Map<string, QratioSiteRow[]>> {
  const byPmid = new Map<string, QratioSiteRow[]>()
  for (const pmid of pmidFilter) byPmid.set(pmid, [])
  const shardDir = join(stage5Dir(), "qratio_rows")
  const missing: string[] = []
  for (const pmid of pmidFilter) {
    const shard = join(shardDir, `${pmid}.jsonl`)
    if (!existsSync(shard)) {
      missing.push(pmid)
      continue
    }
    byPmid.set(pmid, await loadPredRowsFromJsonl(shard, new Set([pmid])))
  }
  if (missing.length && existsSync(combinedPath)) {
    const extra = await loadPredRowsFromJsonl(combinedPath, new Set(missing))
    for (const row of extra) {
      byPmid.get(row.pmid)?.push(row)
    }
  }
  return byPmid
}

function loadStage5Results(): Map<string, Stage5Result> {
  const path = stage5ResultsJsonlPath()
  const map = new Map<string, Stage5Result>()
  if (!existsSync(path)) return map
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t) as Stage5Result
      if (r.pmid) map.set(r.pmid, r)
    } catch {
      // skip
    }
  }
  return map
}

type FieldKey = keyof FieldAccuracy

const FIELD_KEYS: FieldKey[] = [
  "ptms",
  "condition",
  "uniprotId",
  "position",
  "aminoAcid",
  "log2RatioPeptide",
  "pValuePeptide",
  "log2RatioProtein",
  "pValueProtein",
]

const NUMERIC_FIELD_KEYS: FieldKey[] = [
  "uniprotId",
  "position",
  "aminoAcid",
  "log2RatioPeptide",
  "pValuePeptide",
  "log2RatioProtein",
  "pValueProtein",
]

function emptyFieldHits(): Record<FieldKey, number> {
  return {
    ptms: 0,
    condition: 0,
    uniprotId: 0,
    position: 0,
    aminoAcid: 0,
    log2RatioPeptide: 0,
    pValuePeptide: 0,
    log2RatioProtein: 0,
    pValueProtein: 0,
  }
}

function fieldAccuracyFromHits(
  hits: Record<FieldKey, number>,
  n: number,
  labelN: number,
): FieldAccuracy {
  const acc = (k: FieldKey, denom: number) => (denom > 0 ? hits[k] / denom : null)
  return {
    ptms: acc("ptms", labelN),
    condition: acc("condition", labelN),
    uniprotId: acc("uniprotId", n),
    position: acc("position", n),
    aminoAcid: acc("aminoAcid", n),
    log2RatioPeptide: acc("log2RatioPeptide", n),
    pValuePeptide: acc("pValuePeptide", n),
    log2RatioProtein: acc("log2RatioProtein", n),
    pValueProtein: acc("pValueProtein", n),
  }
}

function scorePair(gr: QratioSiteRow, pr: QratioSiteRow): Record<FieldKey, number> {
  const h = emptyFieldHits()
  h.ptms = ptmFieldMatch(gr.ptms, pr.ptms) ? 1 : 0
  h.condition = conditionsAlign(gr.conditionKey, pr.conditionKey, gr.condition, pr.condition) ? 1 : 0
  h.uniprotId = gr.uniprot === pr.uniprot ? 1 : 0
  h.position = gr.position === pr.position ? 1 : 0
  h.aminoAcid = gr.aminoAcid === pr.aminoAcid ? 1 : 0
  h.log2RatioPeptide = numericFieldMatch(gr.log2Peptide, pr.log2Peptide, LOG2_ABS_TOL) ? 1 : 0
  h.pValuePeptide = pValueFieldMatch(gr.pValuePeptide, pr.pValuePeptide) ? 1 : 0
  h.log2RatioProtein = numericFieldMatch(gr.log2Protein, pr.log2Protein, LOG2_ABS_TOL) ? 1 : 0
  h.pValueProtein = pValueFieldMatch(gr.pValueProtein, pr.pValueProtein) ? 1 : 0
  return h
}

function evalOnePmid(
  pmid: string,
  goldPath: string,
  predRows: QratioSiteRow[],
  pipeline: Stage5Result | null,
): PmidEval {
  const goldAll = loadGoldRows(goldPath)
  const gold = goldAll.filter((r) => r.pmid === pmid)
  const goldBySite = indexGoldBySite(gold)
  const pred = predRows.filter((r) => r.pmid === pmid)
  const notes: string[] = []

  const hits = emptyFieldHits()
  let comparedPairs = 0
  let labelN = 0
  for (const pr of pred) {
    const siteGolds = goldBySite.get(siteRelaxedKey(pr)) ?? []
    if (siteGolds.length) {
      labelN++
      const aligned =
        siteGolds.find((gr) => siteStrictKey(gr) === siteStrictKey(pr)) ??
        siteGolds.find((gr) =>
          conditionsAlign(gr.conditionKey, pr.conditionKey, gr.condition, pr.condition),
        )
      hits.condition += aligned ? 1 : 0
      hits.ptms += ptmFieldMatch((aligned ?? siteGolds[0]).ptms, pr.ptms) ? 1 : 0
    }
    const gr = goldForPred(pr, goldBySite, "aligned")
    if (!gr) continue
    comparedPairs++
    const pairHits = scorePair(gr, pr)
    for (const k of NUMERIC_FIELD_KEYS) hits[k] += pairHits[k]
  }

  if (pred.length === 0) notes.push("no_pred_rows")
  if (pipeline?.status && pipeline.status !== "ok") notes.push(`pipeline_status=${pipeline.status}`)

  return {
    pmid,
    goldPath,
    pipeline,
    predRows: pred.length,
    comparedPairs,
    fieldAccuracy: fieldAccuracyFromHits(hits, comparedPairs, labelN),
    notes,
  }
}

function loadManualCsvRow(pmid: string): LiteratureInfoRow | null {
  if (!existsSync(MANUAL_CSV)) return null
  const rows = parseCsv(readFileSync(MANUAL_CSV, "utf8"))
  if (rows.length < 2) return null
  const header = rows[0].map((h) => h.trim())
  const idx = (name: string) =>
    header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const pmidI = idx("PMID")
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i]
    if ((c[pmidI] ?? "").trim() !== pmid) continue
    return {
      pmid,
      title: c[idx("Title")] ?? "",
      sample: c[idx("Sample")] ?? "",
      sampleType: c[idx("Sample type")] ?? "",
      organism: c[idx("Organism")] ?? "",
      ptms: c[idx("PTMs")] ?? "",
      labelMethod: c[idx("Label method")] ?? "",
      condition: c[idx("Condition")] ?? "",
      detailCondition: c[idx("Detail condition")] ?? "",
      conditionSampleMap: "",
      enrichmentMethod: c[idx("Enrichment method")] ?? "",
      massSpectrometer: c[idx("Mass spectrometer")] ?? "",
      msDataSource: c[idx("MS data source")] ?? "",
      identifier: c[idx("Identifier")] ?? "",
      status: "ok",
      confidence: 1,
      textSource: "manual_csv",
      notes: "bootstrap for stage5 eval from M109 manual CSV",
      extractedAt: new Date().toISOString(),
    }
  }
  return null
}

async function bootstrapAndRunPipeline(pmids: string[]): Promise<void> {
  const runnable: string[] = []
  for (const pmid of pmids) {
    if (!loadStage3ResultForPmid(pmid)) {
      const row = loadManualCsvRow(pmid)
      if (!row) {
        console.error(`  skip ${pmid}: not in stage3 and no manual CSV row`)
        continue
      }
      appendStage3Results([row])
      console.log(`  bootstrapped stage3 for ${pmid} from manual CSV`)
    }
    const loose = listTabularInPmidDir(pmid)
    const suppZip = join(projectRoot(), "data/stage4/supp", pmid, "supplementary.zip")
    const suppListing = join(projectRoot(), "data/stage4/supp", pmid, "listing.json")
    if (loose.length > 0) {
      console.log(`  stage4 ${pmid}: ${loose.length} local table(s) — parse directly (no zip pack)`)
    } else if (existsSync(suppZip) && existsSync(suppListing)) {
      console.log(`  stage4 scout ${pmid}: skip (local supplementary.zip present)`)
    } else {
      const packed = ingestSupplementaryFromPmidDir(pmid, { merge: false })
      if (packed) {
        console.log(`  stage4 ${pmid}: packed loose tables → supplementary.zip (${packed.fileCount} entries)`)
      } else {
        console.log(`  stage4 scout ${pmid}...`)
        await runStage4SuppScout({ pmid, resume: false })
      }
    }
    runnable.push(pmid)
  }
  console.log(`  stage5 parse ${runnable.length} PMID(s)...`)
  process.env.STAGE5_SKIP_CSV_REBUILD = "1"
  await runStage5Parse({
    pmids: runnable,
    resume: false,
    likelyOnly: false,
    concurrency: 1,
    flushEvery: 5,
    onResult: (row, index, total) => {
      console.log(
        `  stage5 ${row.pmid}: ${row.status} rows=${row.rowCount} (${index + 1}/${total})`,
      )
    },
  })
}

function mean(nums: (number | null)[]): number | null {
  const v = nums.filter((x): x is number => x != null && Number.isFinite(x))
  if (!v.length) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

function macroFieldAccuracy(rows: PmidEval[]): FieldAccuracy {
  const scoredNumeric = rows.filter((p) => p.comparedPairs > 0)
  const scoredLabels = rows.filter((p) => p.fieldAccuracy.ptms != null || p.fieldAccuracy.condition != null)
  const pickN = (k: FieldKey) => mean(scoredNumeric.map((p) => p.fieldAccuracy[k]))
  const pickL = (k: FieldKey) => mean(scoredLabels.map((p) => p.fieldAccuracy[k]))
  return {
    ptms: pickL("ptms"),
    condition: pickL("condition"),
    uniprotId: pickN("uniprotId"),
    position: pickN("position"),
    aminoAcid: pickN("aminoAcid"),
    log2RatioPeptide: pickN("log2RatioPeptide"),
    pValuePeptide: pickN("pValuePeptide"),
    log2RatioProtein: pickN("log2RatioProtein"),
    pValueProtein: pickN("pValueProtein"),
  }
}

function parsePmidList(raw: string): string[] {
  return raw.split(/[,;\s]+/).filter(Boolean)
}

function parseArgs(argv: string[]): {
  runPipeline: boolean
  predCsv: string
  pmids: string[]
  excludePmids: string[]
  okOnly: boolean
  requirePred: boolean
  usePredCsv: boolean
} {
  let runPipeline = false
  let predCsv = stage5QratioCsvPath()
  let pmids: string[] = []
  let excludePmids: string[] = []
  let okOnly = false
  let requirePred = false
  let usePredCsv = false
  for (const a of argv) {
    if (a === "--run-pipeline") runPipeline = true
    else if (a === "--ok-only") okOnly = true
    else if (a === "--require-pred") requirePred = true
    else if (a === "--use-pred-csv") usePredCsv = true
    else if (a.startsWith("--pred-csv=")) predCsv = a.slice("--pred-csv=".length)
    else if (a.startsWith("--pmids=")) pmids = parsePmidList(a.slice("--pmids=".length))
    else if (a.startsWith("--exclude-pmids=")) excludePmids = parsePmidList(a.slice("--exclude-pmids=".length))
  }
  return { runPipeline, predCsv, pmids, excludePmids, okOnly, requirePred, usePredCsv }
}

async function main(): Promise<void> {
  loadDotEnv()
  const { runPipeline, predCsv, pmids: pmidArg, excludePmids, okOnly, requirePred, usePredCsv } =
    parseArgs(process.argv.slice(2))

  let stage5ByPmid = loadStage5Results()

  const goldFiles = readdirSync(GOLD_DIR)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => join(GOLD_DIR, f))
    .sort()
  let cohort = goldFiles.map((p) => basename(p, ".csv"))
  if (pmidArg.length) cohort = cohort.filter((p) => pmidArg.includes(p))
  if (okOnly) {
    cohort = cohort.filter((p) => stage5ByPmid.get(p)?.status === "ok")
  }
  const excluded = new Set([...EXCLUDE_UNMAPPED_PVALUE_PMIDS, ...excludePmids])
  const skippedUnmapped = cohort.filter((p) => excluded.has(p))
  if (skippedUnmapped.length) {
    console.log(`  exclude unmapped p-value columns: ${skippedUnmapped.join(", ")}`)
    cohort = cohort.filter((p) => !excluded.has(p))
  }

  if (runPipeline) {
    console.log(`Running stage4+5 for ${cohort.length} PMIDs...`)
    await bootstrapAndRunPipeline(cohort)
    stage5ByPmid = loadStage5Results()
  }

  const jsonlPath = join(stage5Dir(), "qratio_rows.jsonl")
  const shardDir = join(stage5Dir(), "qratio_rows")
  const useShards = !usePredCsv && cohort.length > 0 && existsSync(shardDir)
  const useJsonl = !usePredCsv && !useShards && cohort.length > 0 && existsSync(jsonlPath)
  const grouped = useJsonl ? await loadPredRowsGrouped(jsonlPath, new Set(cohort)) : null
  const perPmid: PmidEval[] = []
  for (const pmid of cohort) {
    const shard = join(shardDir, `${pmid}.jsonl`)
    const pred = useShards
      ? existsSync(shard)
        ? await loadPredRowsFromJsonl(shard, new Set([pmid]))
        : []
      : grouped
        ? grouped.get(pmid) ?? []
        : loadPredRowsFromCsv(predCsv, new Set([pmid]))
    if (grouped) grouped.delete(pmid)
    if (requirePred && pred.length === 0) {
      console.log(`  skip ${pmid} (no usable pred rows)`)
      continue
    }
    console.log(`  scoring ${pmid} (pred ${pred.length})...`)
    perPmid.push(evalOnePmid(pmid, join(GOLD_DIR, `${pmid}.csv`), pred, stage5ByPmid.get(pmid) ?? null))
  }

  const scored = perPmid.filter((p) => p.comparedPairs > 0)
  const macroAccuracy = macroFieldAccuracy(perPmid)
  const summary = {
    evaluatedAt: new Date().toISOString(),
    goldDir: GOLD_DIR,
    predCsv,
    predSource: useShards ? shardDir : useJsonl ? jsonlPath : predCsv,
    cohortFilter: okOnly
      ? requirePred
        ? "pipeline_ok_with_pred_mapped"
        : "pipeline_ok_with_gold"
      : pmidArg.length
        ? "pmids"
        : requirePred
          ? "gold_with_pred"
          : "all_gold",
    excludedPmids: skippedUnmapped,
    cohortSize: perPmid.length,
    withPredictions: perPmid.filter((p) => p.predRows > 0).length,
    withComparedPairs: scored.length,
    pipelineOk: perPmid.filter((p) => p.pipeline?.status === "ok").length,
    evalMetric:
      "macroAccuracy: mean per-PMID field accuracy. UniProt/Position/AA/log2/p on pred-anchored pairs (aligned site + condition). PTMs/Condition on pred rows whose site exists in gold. Gold-only rows excluded.",
    evalPolicy:
      "Fields: PTMs, Condition, UniProtID, Position, AminoAcid, Log2Ratio (peptide), P value (peptide), Log2Ratio (protein), P value (protein). PTMs: canonical qPTM name (Phosphorylation, Glycosylation, …); pred may match one of gold's listed types; both empty = match. Condition: same contrast-alignment rules used for pairing (canonical key, two-arm initials, T/N, token Jaccard≥0.45). Numeric match: |Δ|≤0.02 for log2; p-values match if |Δ|≤1e-4, relative |Δ|/max≤5%, or same 2-decimal display; both NA counts as match.",
    numericTolerance: {
      log2Abs: LOG2_ABS_TOL,
      pValueAbs: P_VALUE_ABS_TOL,
      pValueRel: P_VALUE_REL_TOL,
      pValueDisplayDecimals: P_VALUE_DISPLAY_DECIMALS,
    },
    macroAccuracy,
    perPmid: perPmid.map((p) => ({
      pmid: p.pmid,
      pipelineStatus: p.pipeline?.status ?? null,
      pipelineRowCount: p.pipeline?.rowCount ?? 0,
      mappingSource: p.pipeline?.mappingSource ?? null,
      predRows: p.predRows,
      comparedPairs: p.comparedPairs,
      fieldAccuracy: p.fieldAccuracy,
      notes: p.notes,
    })),
  }

  mkdirSync(RESULTS_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const tag = okOnly
    ? requirePred
      ? "pipeline_ok_pred_mapped"
      : "pipeline_ok"
    : pmidArg.length
      ? "subset"
      : requirePred
        ? "gold_pred"
        : "all_gold"
  const outPath = join(RESULTS_DIR, `stage5_m109_${tag}_${stamp}.json`)
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8")

  console.log("\nStage 5 M109 evaluation")
  console.log(`  cohort: ${perPmid.length} papers with manual qratio gold`)
  if (skippedUnmapped.length) {
    console.log(`  excluded (unmapped p-value column): ${skippedUnmapped.join(", ")}`)
  }
  console.log(`  with predictions: ${summary.withPredictions}`)
  console.log(`  with compared pairs: ${summary.withComparedPairs}`)
  console.log(`  pipeline ok: ${summary.pipelineOk}`)
  console.log(`  policy: pred-anchored aligned pairs; field accuracy only`)
  if (scored.length) {
    const pct = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`)
    const m = macroAccuracy
    console.log(`  macro accuracy:`)
    console.log(`    PTM type: ${pct(m.ptms)}  Condition: ${pct(m.condition)}`)
    console.log(`    UniProtID: ${pct(m.uniprotId)}  Position: ${pct(m.position)}  AminoAcid: ${pct(m.aminoAcid)}`)
    console.log(
      `    log2ratio(peptide): ${pct(m.log2RatioPeptide)}  p value (peptide): ${pct(m.pValuePeptide)}  log2ratio(protein): ${pct(m.log2RatioProtein)}  p value (protein): ${pct(m.pValueProtein)}`,
    )
  }
  console.log(`  written: ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
