#!/usr/bin/env npx tsx
/**
 * Optional: pack data/stage4/supp/{pmid}/*.csv|xlsx into supplementary.zip + listing.json.
 * Stage 5 can parse loose tables in the PMID directory directly; packing is not required.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { ingestSupplementaryFromPmidDir, listTabularInPmidDir } from "../../src/ingest/manual-supp.js"
import { projectRoot } from "../../src/utils/io.js"

function parseArgs(argv: string[]): { goldOnly: boolean; pmids: string[]; dryRun: boolean } {
  let goldOnly = false
  let dryRun = false
  let pmids: string[] = []
  for (const a of argv) {
    if (a === "--gold-only") goldOnly = true
    else if (a === "--dry-run") dryRun = true
    else if (a.startsWith("--pmids=")) pmids = a.slice("--pmids=".length).split(/[,;\s]+/).filter(Boolean)
  }
  return { goldOnly, pmids, dryRun }
}

function goldPmids(): string[] {
  const dir = join(projectRoot(), "evaluation_data/stage5_qratio_data")
  return readdirSync(dir)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => basename(f, ".csv"))
    .sort()
}

function main(): void {
  const { goldOnly, pmids: pmidArg, dryRun } = parseArgs(process.argv.slice(2))
  const suppRoot = join(projectRoot(), "data/stage4/supp")

  let cohort: string[] = []
  if (pmidArg.length) cohort = pmidArg
  else if (goldOnly) cohort = goldPmids()
  else if (existsSync(suppRoot)) {
    cohort = readdirSync(suppRoot).filter((name) => /^\d+$/.test(name)).sort()
  }

  let packed = 0
  let skipped = 0
  for (const pmid of cohort) {
    const tabular = listTabularInPmidDir(pmid)
    const zip = join(suppRoot, pmid, "supplementary.zip")
    const listing = join(suppRoot, pmid, "listing.json")
    if (tabular.length === 0 && existsSync(zip) && existsSync(listing)) {
      skipped++
      continue
    }
    if (tabular.length === 0) {
      skipped++
      continue
    }
    if (dryRun) {
      console.log(`[dry-run] ${pmid}: pack ${tabular.length} file(s)`)
      packed++
      continue
    }
    const r = ingestSupplementaryFromPmidDir(pmid, { merge: false })
    if (r) {
      console.log(`packed ${pmid}: ${r.fileCount} entries in zip`)
      packed++
    } else skipped++
  }
  console.log(`done: packed=${packed} skipped=${skipped} cohort=${cohort.length}`)
}

main()
