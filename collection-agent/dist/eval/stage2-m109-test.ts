#!/usr/bin/env npx tsx
/**
 * Stage 2 discover + fulltext for M109 held-out test PMIDs (for Stage 3 eval with fulltext).
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { discoverForPmid } from "../../src/stage2/discover.js"
import { fetchFulltextForPmid, type FulltextRecord } from "../../src/stage2/fulltext.js"
import { appendStage2Manifest, writeStage2Outputs } from "../../src/pipeline/stage2.js"
import { writeFulltextOutputs } from "../../src/pipeline/stage2-fulltext.js"
import { resolveAbstractsForPmids } from "../../src/stage1/resolve-abstracts.js"
import { loadDotEnv } from "../../src/runtime.js"
import { parseCsv, projectRoot, readTextFile, stage2ManifestJsonlPath } from "../../src/utils/io.js"
import type { Stage2Manifest } from "../../src/stage2/discover.js"

const SPLIT_PATH = join(projectRoot(), "evaluation_data/splits/m109_meta_split.json")
const MANUAL_CSV = join(projectRoot(), "evaluation_data/qPTM3_manul_collect_109pmids.csv")

function loadTestPmids(): string[] {
  const split = JSON.parse(readTextFile(SPLIT_PATH)) as { test: string[] }
  return [...split.test].sort()
}

function loadManualTitles(): Map<string, string> {
  const rows = parseCsv(readTextFile(MANUAL_CSV))
  const h = rows[0].map((x) => x.trim().replace(/^\uFEFF/, ""))
  const idx = (name: string) => h.findIndex((c) => c.toLowerCase() === name.toLowerCase())
  const map = new Map<string, string>()
  for (let i = 1; i < rows.length; i++) {
    const pmid = (rows[i][idx("PMID")] ?? "").trim()
    if (!/^\d+$/.test(pmid)) continue
    map.set(pmid, (rows[i][idx("Title")] ?? "").trim())
  }
  return map
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

function loadPriorFulltext(): FulltextRecord[] {
  const path = join(projectRoot(), "data/stage2/fulltext_manifest.jsonl")
  if (!existsSync(path)) return []
  const out: FulltextRecord[] = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as FulltextRecord)
    } catch {
      // skip
    }
  }
  return out
}

function reloadAllDiscoverManifests(): Stage2Manifest[] {
  const path = stage2ManifestJsonlPath()
  if (!existsSync(path)) return []
  const byPmid = new Map<string, Stage2Manifest>()
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const row = JSON.parse(t) as Stage2Manifest
      if (row.pmid) byPmid.set(row.pmid, row)
    } catch {
      // skip
    }
  }
  return [...byPmid.values()]
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function runner() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: n }, () => runner()))
  return results
}

const MANUAL_PDF_PMIDS = [
  "35231659",
  "35417684",
  "35835037",
  "35960654",
  "35974424",
  "36094355",
  "36097143",
  "36638793",
  "36881336",
  "37236596",
  "39098729",
  "39432924",
]

async function ingestUploadedPdfs(pmids: string[]): Promise<FulltextRecord[]> {
  const { ingestManualFulltext } = await import("../src/ingest/manual-fulltext.js")
  const out: FulltextRecord[] = []
  for (const pmid of pmids) {
    const dir = join(projectRoot(), "data/stage2/fulltext", pmid)
    const candidates = [
      join(dir, `${pmid}.pdf`),
      join(dir, "fulltext.pdf"),
    ].filter((p) => existsSync(p))
    if (candidates.length === 0) {
      console.warn(`[ingest] ${pmid}: no PDF in ${dir}`)
      continue
    }
    const record = await ingestManualFulltext({ pmid, filePath: candidates[0] })
    out.push(record)
    console.log(`[ingest] ${pmid} → ${record.status} pdf=${record.hasPdf}`)
  }
  return out
}

async function main(): Promise<void> {
  loadDotEnv()
  const args = process.argv.slice(2)
  const discoverOnly = args.includes("--discover-only")
  const fulltextOnly = args.includes("--fulltext-only")
  const ingestOnly = args.includes("--ingest-manual-pdfs")
  const force = args.includes("--force")
  const concurrency = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 2)

  const testPmids = ingestOnly ? MANUAL_PDF_PMIDS : loadTestPmids()

  if (ingestOnly) {
    const fresh = await ingestUploadedPdfs(testPmids)
    const merged = new Map<string, FulltextRecord>()
    for (const r of loadPriorFulltext()) merged.set(r.pmid, r)
    for (const r of fresh) merged.set(r.pmid, r)
    writeFulltextOutputs([...merged.values()].sort((a, b) => a.pmid.localeCompare(b.pmid)))
    console.log(`[ingest] updated manifest for ${fresh.length} PMID(s)`)
    return
  }
  const titles = loadManualTitles()
  console.log(`M109 test PMIDs: ${testPmids.length}`)

  console.log("Resolving abstracts…")
  const resolved = await resolveAbstractsForPmids(testPmids, { cache: true })
  const absByPmid = new Map(resolved.records.map((r) => [r.pmid, r]))
  if (resolved.missing.length) {
    console.warn(`Missing abstract: ${resolved.missing.join(", ")}`)
  }

  let discover = loadDiscoverByPmid()

  if (!fulltextOnly) {
    const needDiscover = testPmids.filter((pmid) => {
      if (force) return true
      const d = discover.get(pmid)
      return !d || d.status === "error"
    })
    console.log(`[discover] ${needDiscover.length}/${testPmids.length} to run`)
    await mapPool(needDiscover, concurrency, async (pmid, i) => {
      const abs = absByPmid.get(pmid)
      const title = abs?.title || titles.get(pmid) || ""
      const abstract = abs?.abstract || ""
      const m = await discoverForPmid({ pmid, title, abstract })
      appendStage2Manifest(m)
      discover.set(pmid, m)
      console.log(`[discover] ${i + 1}/${needDiscover.length} ${pmid} → ${m.status} doi=${m.doi ?? "-"} pmcid=${m.pmcid ?? "-"}`)
    })
    writeStage2Outputs(reloadAllDiscoverManifests())
  }

  if (!discoverOnly) {
    discover = loadDiscoverByPmid()
    const prior = loadPriorFulltext()
    const priorByPmid = new Map(prior.map((r) => [r.pmid, r]))

    const needFulltext = testPmids.filter((pmid) => {
      if (force) return true
      const r = priorByPmid.get(pmid)
      return !r || (!r.hasXml && !r.hasPdf)
    })
    console.log(`[fulltext] ${needFulltext.length}/${testPmids.length} to fetch`)

    const fresh = await mapPool(needFulltext, concurrency, async (pmid, i) => {
      const disc = discover.get(pmid)
      const abs = absByPmid.get(pmid)
      const title = abs?.title || titles.get(pmid) || disc?.title || ""
      const record = await fetchFulltextForPmid({
        pmid,
        title,
        doi: disc?.doi ?? null,
        pmcid: disc?.pmcid ?? null,
        isOpenAccess: disc?.isOpenAccess,
      })
      console.log(
        `[fulltext] ${i + 1}/${needFulltext.length} ${pmid} → ${record.status} xml=${record.hasXml} pdf=${record.hasPdf}`,
      )
      return record
    })

    const merged = new Map<string, FulltextRecord>()
    for (const r of prior) merged.set(r.pmid, r)
    for (const r of fresh) merged.set(r.pmid, r)
    const records = [...merged.values()].sort((a, b) => a.pmid.localeCompare(b.pmid))
    writeFulltextOutputs(records)

    const testSet = new Set(testPmids)
    const testRecords = records.filter((r) => testSet.has(r.pmid))
    const withXml = testRecords.filter((r) => r.hasXml).length
    const withPdf = testRecords.filter((r) => r.hasPdf).length
    const withEither = testRecords.filter((r) => r.hasXml || r.hasPdf).length
    console.log(
      `\n[fulltext] test coverage: xml=${withXml} pdf=${withPdf} any=${withEither}/${testPmids.length}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
