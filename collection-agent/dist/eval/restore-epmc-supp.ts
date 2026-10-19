#!/usr/bin/env npx tsx
/** Fetch Europe PMC supplementary ZIP when local cache was cleared. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fetchEuropePmcSupplementaryZip } from "../../src/stage2/clients/europepmc.js"
import { decideVerdict, listAndScoreZip, scanLocalXmlSupp } from "../../src/stage4/supp-scout.js"
import { rebuildStage4Outputs } from "../../src/pipeline/stage4-supp.js"
import type { SuppScoutRecord } from "../../src/types.js"
import { writeBuffer } from "../../src/stage4/zip.js"
import { stage4SuppDir, projectRoot, stage4SuppScoutJsonlPath } from "../../src/utils/io.js"

function loadAllScoutRecords(): SuppScoutRecord[] {
  const path = stage4SuppScoutJsonlPath()
  if (!existsSync(path)) return []
  const byPmid = new Map<string, SuppScoutRecord>()
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t) as SuppScoutRecord
      if (r.pmid) byPmid.set(r.pmid, r)
    } catch {
      // skip
    }
  }
  return [...byPmid.values()]
}

/** Stage5 eval gold cohort — fetch EPMC zip when missing locally. */
const PMCS: Record<string, string> = {
  "38977202": "PMC11338950",
  "40368138": "PMC12181035",
  "35742860": "PMC9223697",
  "36881336": "PMC10409921",
  "35005567": "PMC8718978",
  "35688384": "PMC9294201",
  "38840842": "PMC11152682",
  "39732660": "PMC11681642",
}

/** PMIDs with local zip that should enter stage5 job queue even if verdict is weak. */
const FORCE_JOB_PMIDS = new Set(["35742860"])

async function main(): Promise<void> {
  for (const [pmid, pmcid] of Object.entries(PMCS)) {
    const dir = join(stage4SuppDir(), pmid)
    const localZip = join(dir, "supplementary.zip")
    const listingPath = join(dir, "listing.json")
    const userUpload = join(dir, "source_user_upload.txt")
    if (existsSync(userUpload)) {
      console.log(`${pmid}: skip fetch (user upload)`)
      if (existsSync(localZip) && !existsSync(listingPath)) {
        const hits = listAndScoreZip(localZip)
        writeFileSync(listingPath, JSON.stringify(hits, null, 2), "utf8")
      }
      continue
    }
    if (existsSync(localZip)) {
      if (!existsSync(listingPath)) {
        const hits = listAndScoreZip(localZip)
        writeFileSync(listingPath, JSON.stringify(hits, null, 2), "utf8")
        console.log(`${pmid}: wrote listing.json (${hits.length} entries)`)
      } else {
        console.log(`${pmid}: already has supplementary.zip`)
      }
      continue
    }
    console.log(`${pmid}: fetching ${pmcid}…`)
    const fetched = await fetchEuropePmcSupplementaryZip(pmcid)
    if (fetched.status !== "ok" || !fetched.buffer) {
      console.error(`  failed: ${fetched.status} ${fetched.error ?? ""}`)
      continue
    }
    mkdirSync(dir, { recursive: true })
    writeBuffer(localZip, fetched.buffer)
    const hits = listAndScoreZip(localZip)
    writeFileSync(listingPath, JSON.stringify(hits, null, 2), "utf8")
    console.log(`  ok (${fetched.buffer.length} bytes, ${hits.length} entries)`)
  }

  // Upsert scout rows: mark zip ok for restored PMIDs
  const all = loadAllScoutRecords()
  const byPmid = new Map(all.map((r) => [r.pmid, r]))
  for (const pmid of Object.keys(PMCS)) {
    const localZip = join(stage4SuppDir(), pmid, "supplementary.zip")
    if (!existsSync(localZip)) continue
    const prev = byPmid.get(pmid)
    if (!prev) continue
    const listingFile = join(stage4SuppDir(), pmid, "listing.json")
    if (!existsSync(listingFile)) continue
    const zipHits = JSON.parse(readFileSync(listingFile, "utf8")) as ReturnType<
      typeof listAndScoreZip
    >
    const xml = scanLocalXmlSupp(pmid)
    const { verdict, notes } = decideVerdict({
      hasPmcid: Boolean(prev.pmcid),
      zipStatus: "ok",
      xml,
      zipHits,
    })
    byPmid.set(pmid, {
      ...prev,
      verdict,
      zipStatus: "ok",
      zipPath: join("data/stage4/supp", pmid, "supplementary.zip"),
      zipHitCount: zipHits.length,
      topFiles: zipHits
        .slice(0, 8)
        .map((h) => `${h.path}[${h.kind} score=${h.score}]`)
        .join(" | "),
      notes: notes || prev.notes,
    })
  }
  const outPath = stage4SuppScoutJsonlPath()
  writeFileSync(
    outPath,
    [...byPmid.values()].map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  )
  for (const pmid of FORCE_JOB_PMIDS) {
    const localZip = join(stage4SuppDir(), pmid, "supplementary.zip")
    if (!existsSync(localZip)) continue
    const prev = byPmid.get(pmid)
    if (!prev) continue
    const listingFile = join(stage4SuppDir(), pmid, "listing.json")
    if (!existsSync(listingFile)) continue
    const zipHits = JSON.parse(readFileSync(listingFile, "utf8")) as ReturnType<
      typeof listAndScoreZip
    >
    byPmid.set(pmid, {
      ...prev,
      zipStatus: "ok",
      zipPath: join("data/stage4/supp", pmid, "supplementary.zip"),
      verdict: "has_tabular_supp",
      zipHitCount: zipHits.length,
    })
  }

  writeFileSync(
    stage4SuppScoutJsonlPath(),
    [...byPmid.values()].map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  )
  rebuildStage4Outputs()
  console.log("rebuilt stage4 outputs")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
