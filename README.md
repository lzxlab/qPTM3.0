# qPTM 3.0 — Quantitative PTM Database & AI Agent

A comprehensive resource for quantitative post-translational modification (PTM) proteomics data, integrated with an AI research assistant that guides users through a structured PTM investigation workflow.


## Architecture

Two services power the agent:

| Service | Stack | Port | Role |
|---------|-------|------|------|
| **agent-runtime** | TypeScript / Hono | 8101 | Chat API, ReAct loop, conversations |
| **agent-backend** | Python / FastAPI | 8100 | PTM tools, collection jobs, PDF export |

The browser UI (`agent.php`, `assets/js/agent.js`) calls `/agent-api/*` (Apache routes in `deploy/apache-agent-runtime.conf`). Runtime invokes backend tools over **MCP stdio**; backend reads qPTM (PHP/MySQL), local datasets, and external APIs (UniProt, iPTMnet, etc.).

## How the agent works

1. User question arrives via **SSE streaming** (`POST /chat`).
2. Runtime extracts entities (gene, UniProt, site, PMID) and loads matching **skills** from `skills/`.
3. A **ReAct loop** picks tools, runs them through MCP, and writes a cited answer.
4. Backend exposes ~49 tools (`agent-backend/app/tools/`).

Literature **collection** (PDF / PMID ingestion) is a separate backend pipeline consisted of six steps: literature screening, full-text retrieval, metadata extraction, supplementary data identification, quantitative table parsing and raw MS data acquisition .

## Configuration

Set `DEEPSEEK_API_KEY` in `agent-backend/.env`. Other API URLs and data paths are documented in that file.