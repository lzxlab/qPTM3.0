#!/usr/bin/env npx tsx
/**
 * List M109 PMIDs with downloadable / local supplementary material for Stage5 gold expansion.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { runStage4SuppScout } from "../../src/pipeline/stage4-supp.js"
import type { SuppScoutRecord } from "../../src/types.js"
import { appendStage3Results, loadStage3ResultForPmid, parseCsv, projectRoot, stage4SuppDir, stage4SuppScoutJsonlPath } from "../../src/utils/io.js"
import type { LiteratureInfoRow } from "../../src/types.js"

const M109_PMIDS = join(projectRoot(), "evaluation_data/splits/m109_pmids.json")
const MANUAL_CSV = join(projectRoot(), "evaluation_data/qPTM3_manul_collect_109pmids.csv")
const EXISTING_GOLD = new Set(
  readdirSync(join(projectRoot(), "evaluation_data/stage5_qratio_data"))
    .filter((f) => f.endsWith(".csv"))
    .map((f) => f.replace(/\.csv$/, "")),
)

function loadM109(): string[] {
  const j = JSON.parse(readFileSync(M109_PMIDS, "utf8")) as { pmids: string[] }
  return j.pmids
}

function loadScoutByPmid(): Map<string, SuppScoutRecord> {
  const path = stage4SuppScoutJsonlPath()
  const map = new Map<string, SuppScoutRecord>()
  if (!existsSync(path)) return map
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t) as SuppScoutRecord
      if (r.pmid) map.set(r.pmid, r)
    } catch {
      // skip
    }
  }
  return map
}

function hasLocalZip(pmid: string): boolean {
  const z = join(stage4SuppDir(), pmid, "supplementary.zip")
  return existsSync(z)
}

function loadManualRow(pmid: string): LiteratureInfoRow | null {
  const rows = parseCsv(readFileSync(MANUAL_CSV, "utf8"))
  const header = rows[0].map((h) => h.trim())
  const idx = (n: string) => header.findIndex((h) => h.toLowerCase() === n.toLowerCase())
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
      notes: "bootstrap for stage4 scout",
      extractedAt: new Date().toISOString(),
    }
  }
  return null
}

function tier(r: SuppScoutRecord | undefined, localZip: boolean): string {
  if (localZip) return "A_local_zip"
  if (!r) return "unknown"
  if (r.zipStatus === "ok" && r.zipPath) return "A_zip_ok"
  if (r.verdict === "likely_qptm_table" || r.verdict === "has_tabular_supp") return "B_verdict_tabular"
  if (r.pmcid && r.zipStatus !== "ok") return "C_pmcid_no_zip"
  return "D_unavailable"
}

async function main(): Promise<void> {
  const scout = argsScout()
  const m109 = loadM109().filter((p) => !EXISTING_GOLD.has(p))
  const byPmid = loadScoutByPmid()

  if (scout) {
    for (const pmid of m109) {
      const r = byPmid.get(pmid)
      const local = hasLocalZip(pmid)
      if (local || r?.zipStatus === "ok") continue
      if (!loadStage3ResultForPmid(pmid)) {
        const row = loadManualRow(pmid)
        if (row) appendStage3Results([row])
        else continue
      }
      console.error(`scout ${pmid}...`)
      await runStage4SuppScout({ pmid, resume: false })
    }
    // refresh
    byPmid.clear()
    for (const [k, v] of loadScoutByPmid()) byPmid.set(k, v)
  }

  const buckets: Record<string, string[]> = {
    A_ready: [],
    B_tabular_clue: [],
    C_retry: [],
    D_skip: [],
  }

  for (const pmid of m109) {
    const r = byPmid.get(pmid)
    const local = hasLocalZip(pmid)
    const t = tier(r, local)
    if (t === "A_local_zip" || t === "A_zip_ok") buckets.A_ready.push(pmid)
    else if (t === "B_verdict_tabular") buckets.B_tabular_clue.push(pmid)
    else if (t === "C_pmcid_no_zip") buckets.C_retry.push(pmid)
    else buckets.D_skip.push(pmid)
  }

  console.log(JSON.stringify({ excludedExistingGold: [...EXISTING_GOLD], counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])), buckets, details: m109.map((p) => ({ pmid: p, tier: tier(byPmid.get(p), hasLocalZip(p)), verdict: byPmid.get(p)?.verdict, zipStatus: byPmid.get(p)?.zipStatus, pmcid: byPmid.get(p)?.pmcid })) }, null, 2))
}

function argsScout(): boolean {
  return process.argv.includes("--scout-missing")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
