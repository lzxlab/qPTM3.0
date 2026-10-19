#!/usr/bin/env npx tsx
/** Crosswalk stage5 qratio gold CSVs vs stage4 supp and stage5 pipeline status. */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { listTabularInPmidDir } from "../../src/ingest/manual-supp.js"
import { projectRoot, stage5ResultsJsonlPath } from "../../src/utils/io.js"

const GOLD_DIR = join(projectRoot(), "evaluation_data/stage5_qratio_data")
const SUPP_DIR = join(projectRoot(), "data/stage4/supp")
const OUT = join(projectRoot(), "evaluation_data/splits/stage5_gold_readiness.json")

function loadStage5Status(): Map<string, { status: string; rowCount: number }> {
  const map = new Map<string, { status: string; rowCount: number }>()
  const path = stage5ResultsJsonlPath()
  if (!existsSync(path)) return map
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t) as { pmid?: string; status?: string; rowCount?: number }
      if (r.pmid) map.set(r.pmid, { status: r.status ?? "unknown", rowCount: r.rowCount ?? 0 })
    } catch {
      // skip
    }
  }
  return map
}

function main(): void {
  const goldPmids = readdirSync(GOLD_DIR)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => basename(f, ".csv"))
    .sort()

  const stage5 = loadStage5Status()
  const rows = goldPmids.map((pmid) => {
    const suppDir = join(SUPP_DIR, pmid)
    const listing = join(suppDir, "listing.json")
    const zip = join(suppDir, "supplementary.zip")
    const tabularPaths = listTabularInPmidDir(pmid)
    const suppFileCount = tabularPaths.length
    const s5 = stage5.get(pmid)
    const hasSuppListing = existsSync(listing)
    const hasSuppZip = existsSync(zip)
    const hasSuppFiles = suppFileCount > 0
    return {
      pmid,
      hasGold: true,
      hasSuppListing,
      hasSuppZip,
      suppFileCount,
      hasSuppFiles,
      stage5Status: s5?.status ?? null,
      stage5RowCount: s5?.rowCount ?? 0,
      readyForParse: hasSuppFiles || (hasSuppListing && hasSuppZip),
      needsPackFromTables: false,
      needsScoutOrZip: !hasSuppFiles && !(hasSuppListing && hasSuppZip),
      evalOkOnly: s5?.status === "ok",
    }
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    goldCount: goldPmids.length,
    withSuppFiles: rows.filter((r) => r.hasSuppFiles).length,
    withSuppZipReady: rows.filter((r) => r.hasSuppListing && r.hasSuppZip).length,
    readyForParse: rows.filter((r) => r.readyForParse).length,
    needsPackFromTables: rows.filter((r) => r.needsPackFromTables).length,
    needsScout: rows.filter((r) => r.needsScoutOrZip).length,
    stage5Ok: rows.filter((r) => r.stage5Status === "ok").length,
    stage5Missing: rows.filter((r) => !r.stage5Status).length,
    stage5NotOk: rows.filter((r) => r.stage5Status && r.stage5Status !== "ok").length,
    evalOkCohortSize: rows.filter((r) => r.evalOkOnly).length,
    pmids: rows,
  }

  mkdirSync(join(projectRoot(), "evaluation_data/splits"), { recursive: true })
  writeFileSync(OUT, JSON.stringify(summary, null, 2) + "\n", "utf8")

  console.log(`Stage5 gold readiness: n=${summary.goldCount}`)
  console.log(`  supp dir has files: ${summary.withSuppFiles}`)
  console.log(`  ready for parse (dir tables or zip): ${summary.readyForParse}`)
  console.log(`  supp zip+listing (optional): ${summary.withSuppZipReady}`)
  console.log(`  needs EPMC scout (no local tables): ${summary.needsScout}`)
  console.log(`  pipeline ok: ${summary.stage5Ok} (eval --ok-only cohort)`)
  console.log(`  no stage5 run yet: ${summary.stage5Missing}`)
  console.log(`  stage5 not ok: ${summary.stage5NotOk}`)
  console.log(`  written: ${OUT}`)
}

main()
