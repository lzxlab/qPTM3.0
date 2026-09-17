# qPTM 3.0 — Quantitative PTM Database & AI Agent

A comprehensive resource for quantitative post-translational modification (PTM) proteomics data, integrated with an AI research assistant that guides users through a structured PTM investigation workflow.


## Architecture

Two services power the agent:

| Service | Stack | Port | Role |
|---------|-------|------|------|
| **agent-runtime** | TypeScript / Hono | 8101 | Chat API, ReAct loop, conversations |
| **agent-backend** | Python / FastAPI | 8100 | PTM tools, collection jobs, PDF export |

The browser UI calls `/agent-api/*` (Apache routes in `deploy/apache-agent-runtime.conf`). Runtime invokes backend tools over **MCP stdio**; backend reads qPTM (PHP/MySQL), local datasets, and external APIs.

## PTM research agent

1. User question arrives via **SSE streaming** (`POST /agent-api/chat` → agent-runtime :8101).
2. Runtime extracts entities (gene, UniProt, site, PMID) and loads matching **skills** from `skills/`.
3. A **ReAct loop** selects **intent tools** (e.g. `get_site_conditions`, `get_upstream_enzymes`), invokes them over **MCP stdio**, and writes a cited answer.
4. Each intent maps to one or more backend tools (~49 total in `agent-backend/app/tools/`).

## Collection agent

| Step | Purpose |
|-------|----------|---------|
| 1 | LLM abstract screening |
| 2 | OA fulltext fetch |
| 3 | Experimental information extraction |
| 4 | Scout / manual table upload |
| 5 | Parse to qratio schema |
| 6 | PRIDE / iProX / jPOST / CPTAC download links |

Literature **collection** (PDF / PMID ingestion) is a separate backend pipeline with six steps: literature screening, full-text retrieval, metadata extraction, supplementary data identification, quantitative table parsing, and raw MS data acquisition.

## Configuration

Set `DEEPSEEK_API_KEY` in `agent-backend/.env`. Other API URLs and data paths are documented in that file.