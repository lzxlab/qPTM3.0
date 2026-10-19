# Collection Agent

Interactive literature collection pipeline for **qPTM 3.0** (`agent.php` → Data collection mode).

Each PMID runs as a single job under `collection-agent/runtime/collection/jobs/{job_id}/`. The user steps through Stage 1–6 with Continue / upload prompts; outputs are CSV artifacts for download (no MySQL).

## CLI (invoked by agent-backend)

```bash
npx tsx src/index.ts run-job --pmid <id> --out-dir <dir> --job-id <id> [options]
npx tsx src/index.ts ingest-fulltext --pmid <id> --file <path> --out-dir <dir>
npx tsx src/index.ts ingest-supp --pmid <id> --file <path> --out-dir <dir>
npx tsx src/index.ts resolve-urls --accession PXD012345 --out-dir <dir> [--job-id <id>]
```

Standalone MS URL resolution (no PMID pipeline):

```bash
npx tsx src/index.ts resolve-urls \
  --accession PXD012345 \
  --out-dir runtime/collection/jobs/urls-demo \
  --job-id urls-demo
# Also: --accession IPX000… (repeatable) · --organism · --modification
```

Backend: `POST /collection/resolve-urls` with JSON `{ "accession": "PXD012345" }`,
or chat messages like “get PRIDE PXD012345 download link” (routed via collection mode).


## Layout

```
collection-agent/
├── src/
│   ├── index.ts              # CLI entry (run-job, ingest-*, resolve-urls)
│   ├── pipeline/             # run-job / resolve-urls orchestration + stage runners
│   ├── chains/               # LLM chains (screen, meta, qratio)
│   ├── stage1/ … stage6/     # Stage implementations
│   ├── ingest/               # Manual fulltext / supplementary ingest
│   └── utils/
├── scripts/                  # Stage 6 repository extractors
└── files/example_qratio.csv
```

## Environment

Copy `.env.example` → `.env`. Typical keys:

- `DEEPSEEK_API_KEY`
- `MODEL` (e.g. `deepseek/deepseek-v4-flash`)
- `UNPAYWALL_EMAIL`
- `NCBI_API_KEY` / `NCBI_EMAIL`

Node **≥ 22.19** (`/opt/node22/bin/node` on the qPTM server).
