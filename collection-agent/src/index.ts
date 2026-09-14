#!/usr/bin/env node
/**
 * qPTM Collection Agent CLI — invoked by agent-backend for interactive PMID jobs.
 */
import { ingestManualFulltext } from "./ingest/manual-fulltext.js"
import { ingestManualSupplementary } from "./ingest/manual-supp.js"
import { readJobState } from "./pipeline/job-state.js"
import { runCollectionJob } from "./pipeline/run-job.js"
import { runResolveUrlsJob } from "./pipeline/resolve-urls.js"
import { setDataRoot } from "./utils/io.js"

type Cmd = "help" | "run-job" | "ingest-fulltext" | "ingest-supp" | "resolve-urls"

interface CliArgs {
  cmd: Cmd
  pmid?: string
  outDir?: string
  jobId?: string
  filePath?: string
  /** One or more --supp-file values. */
  suppFilePaths?: string[]
  /** One or more --accession values (resolve-urls). */
  accessions?: string[]
  resumeFrom?: string
  forceInclude?: boolean
  concurrency?: number
  model?: string
  organism?: string
  modification?: string
  title?: string
  msDataSource?: string
  message?: string
}

function printHelp(): void {
  console.log(`qPTM Collection Agent

Usage:
  npx tsx src/index.ts run-job --pmid <id> --out-dir <dir> [options]
  npx tsx src/index.ts ingest-fulltext --pmid <id> --file <path> [--out-dir <dir>]
  npx tsx src/index.ts ingest-supp --pmid <id> --file <path> [--out-dir <dir>]
  npx tsx src/index.ts resolve-urls --accession <PXD…|IPX…|JPST…|MSV…|PDC…> --out-dir <dir> [options]
  npx tsx src/index.ts help

run-job options:
  --job-id <id>           Job id (default: job-<pmid>)
  --file <path>           Manual fulltext PDF/XML
  --supp-file <path>      Supplementary table file (repeatable)
  --resume-from <stage>   auto | stage1 | stage2 | stage3 | stage4 | stage5 | stage6
  --force-include         Override Stage-1 exclude (user Include button)
  --concurrency <n>       Parallel LLM calls (default 1)
  --model <id>            e.g. opencode-go/deepseek-v4-flash

resolve-urls options:
  --accession <id>        MS accession (repeatable; also accepts comma-separated)
  --job-id <id>           Job id (default: urls-<accession>)
  --organism <text>       Optional organism label for output filenames
  --modification <text>   Optional PTM / modification label
  --title <text>          Optional title for the job record
  --pmid <id>             Optional real PubMed ID (never an accession; default: empty)
  --ms-data-source <name> Optional repository hint (iProX / PRIDE / jPOST / …)
  --message <text>        Original user text (used to infer repository, e.g. iProX)

Global:
  --out-dir <path>        Per-job data root (required for run-job / resolve-urls)
`)
}

function pushAccessions(args: CliArgs, raw: string): void {
  const parts = raw
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return
  args.accessions = [...(args.accessions ?? []), ...parts]
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cmd: "help" }
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (
      a === "run-job" ||
      a === "ingest-fulltext" ||
      a === "ingest-supp" ||
      a === "resolve-urls" ||
      a === "help"
    ) {
      args.cmd = a
      continue
    }
    if (a === "--pmid" && argv[i + 1]) {
      args.pmid = argv[++i]
      continue
    }
    if (a === "--out-dir" && argv[i + 1]) {
      args.outDir = argv[++i]
      continue
    }
    if (a === "--job-id" && argv[i + 1]) {
      args.jobId = argv[++i]
      continue
    }
    if (a === "--file" && argv[i + 1]) {
      args.filePath = argv[++i]
      continue
    }
    if (a === "--supp-file" && argv[i + 1]) {
      ;(args.suppFilePaths ??= []).push(argv[++i])
      continue
    }
    if ((a === "--accession" || a === "--accessions") && argv[i + 1]) {
      pushAccessions(args, argv[++i])
      continue
    }
    if (a === "--organism" && argv[i + 1]) {
      args.organism = argv[++i]
      continue
    }
    if (a === "--modification" && argv[i + 1]) {
      args.modification = argv[++i]
      continue
    }
    if (a === "--title" && argv[i + 1]) {
      args.title = argv[++i]
      continue
    }
    if ((a === "--ms-data-source" || a === "--msDataSource") && argv[i + 1]) {
      args.msDataSource = argv[++i]
      continue
    }
    if (a === "--message" && argv[i + 1]) {
      args.message = argv[++i]
      continue
    }
    if (a === "--resume-from" && argv[i + 1]) {
      args.resumeFrom = argv[++i]
      continue
    }
    if (a === "--force-include") {
      args.forceInclude = true
      continue
    }
    if (a === "--concurrency" && argv[i + 1]) {
      args.concurrency = Number(argv[++i])
      continue
    }
    if (a === "--model" && argv[i + 1]) {
      args.model = argv[++i]
      continue
    }
    if (!a.startsWith("-")) positional.push(a)
  }

  if (args.cmd === "help" && positional.length > 0) {
    const cmd = positional[0]
    if (
      cmd === "run-job" ||
      cmd === "ingest-fulltext" ||
      cmd === "ingest-supp" ||
      cmd === "resolve-urls" ||
      cmd === "help"
    ) {
      args.cmd = cmd
    }
  }

  // Bare accessions after resolve-urls: `resolve-urls PXD012345`
  if (args.cmd === "resolve-urls") {
    for (const p of positional.slice(1)) {
      if (/^(PXD|IPX|JPST|MSV|PDC)\d+$/i.test(p)) pushAccessions(args, p)
    }
  }

  return args
}

async function runIngestFulltext(opts: CliArgs): Promise<void> {
  if (!opts.pmid || !opts.filePath) {
    throw new Error("ingest-fulltext requires --pmid and --file")
  }
  const record = await ingestManualFulltext({ pmid: opts.pmid, filePath: opts.filePath })
  console.log(JSON.stringify(record, null, 2))
}

async function runIngestSupp(opts: CliArgs): Promise<void> {
  const paths = [...(opts.suppFilePaths ?? []), ...(opts.filePath ? [opts.filePath] : [])]
  if (!opts.pmid || paths.length === 0) {
    throw new Error("ingest-supp requires --pmid and --file (or --supp-file)")
  }
  const result = ingestManualSupplementary({
    pmid: opts.pmid,
    filePaths: paths,
    merge: true,
  })
  console.log(JSON.stringify(result, null, 2))
}

async function runJob(opts: CliArgs): Promise<void> {
  if (!opts.pmid || !opts.outDir) {
    throw new Error("run-job requires --pmid and --out-dir")
  }
  const jobId = opts.jobId ?? `job-${opts.pmid}`
  process.env.OPENCODE_SESSION = jobId
  const state = await runCollectionJob({
    jobId,
    outDir: opts.outDir,
    pmid: opts.pmid,
    fulltextPath: opts.filePath,
    supplementaryPaths: opts.suppFilePaths,
    resumeFrom: (opts.resumeFrom as "auto" | undefined) ?? "auto",
    forceInclude: Boolean(opts.forceInclude),
    concurrency: opts.concurrency,
    model: opts.model,
    onLog: (msg) => console.error(msg),
  })
  console.log(JSON.stringify(state, null, 2))
  const prior = readJobState(opts.outDir)
  // Force-exit so the node process cannot hang on background handles kept alive
  // by the pi-ai runtime (sockets, timers) — a hanging child keeps the job in
  // "running" forever and blocks resume. All state is already persisted to disk.
  process.exit(prior?.status === "error" ? 1 : 0)
}

async function runResolveUrls(opts: CliArgs): Promise<void> {
  const accessions = opts.accessions ?? []
  if (!opts.outDir || accessions.length === 0) {
    throw new Error("resolve-urls requires --accession and --out-dir")
  }
  const jobId = opts.jobId ?? `urls-${accessions[0].toLowerCase()}`
  process.env.OPENCODE_SESSION = jobId
  const state = await runResolveUrlsJob({
    jobId,
    outDir: opts.outDir,
    accessions,
    pmid: opts.pmid,
    title: opts.title,
    organism: opts.organism,
    modification: opts.modification,
    msDataSource: opts.msDataSource,
    message: opts.message,
    onLog: (msg) => console.error(msg),
  })
  console.log(JSON.stringify(state, null, 2))
  process.exit(state.status === "error" ? 1 : 0)
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.outDir) {
    const root = setDataRoot(opts.outDir)
    console.error(`Using data root: ${root}`)
  }
  if (opts.cmd === "help") {
    printHelp()
    return
  }
  if (opts.cmd === "ingest-fulltext") {
    await runIngestFulltext(opts)
    return
  }
  if (opts.cmd === "ingest-supp") {
    await runIngestSupp(opts)
    return
  }
  if (opts.cmd === "resolve-urls") {
    await runResolveUrls(opts)
    return
  }
  if (opts.cmd === "run-job") {
    await runJob(opts)
    return
  }
  printHelp()
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
