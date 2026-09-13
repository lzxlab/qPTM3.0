# qPTM 3.0 — Quantitative PTM Database & AI Agent

A comprehensive resource for quantitative post-translational modification (PTM) proteomics data, integrated with an AI research assistant that guides users through a structured PTM investigation workflow.


## Architecture

Chat (SSE), classify, and conversations are served by **agent-runtime** (TypeScript / Hono, port 8101). Collection jobs, tool registry, and PDF export stay on **agent-backend** (FastAPI, port 8100). Runtime talks to Python tools over MCP stdio.

```
┌─────────────┐  /agent-api/chat|classify|conversations   ┌──────────────────┐
│  agent.php  │ ─────────────────────────────────────────►│ agent-runtime    │
│  + agent.js │                                           │ Hono :8101       │
└──────┬──────┘  /agent-api/collection|tools|export       └────────┬─────────┘
       └──────────────────────────────────────────►┌───────────────▼─────────┐
                                                   │ agent-backend FastAPI   │
                                                   │ :8100  + MCP stdio      │
                                                   └───────────┬─────────────┘
                         ┌─────────────────────────────────────┼──────────────┐
                         ▼                                     ▼              ▼
                   api/*.php (MySQL)                    data/*/SOURCE.yaml   UniProt / PubTator / …
```

| Component | Technology | Location |
|-----------|-----------|----------|
| Website frontend | HTML/JS/CSS | Root `*.html` |
| Website backend | PHP + MySQL | `resource/functions.php` |
| Agent chat UI | HTML/JS | `agent.php`, `assets/js/agent.js` |
| qPTM data API | PHP + MySQL | `api/*.php` |
| Agent runtime | TypeScript + Hono | `agent-runtime/` (unified Q&A + investigation) |
| Agent backend | Python + FastAPI | `agent-backend/` (tools, collection, MCP) |
| Collection CLI | TypeScript | `collection-agent/` |
| LLM | DeepSeek (OpenAI-compatible) | External API |

Apache routing: `deploy/apache-agent-runtime.conf`.

## Tools

The agent backend registers ~49 tools (`agent-backend/app/tools/register_all.py`). Each tool queries a specific data source and returns structured results. Runtime selects a top-K subset per question.

### Representative tools (not the full catalog)

| # | Tool | Stage | Data Source | Direction |
|---|------|-------|-------------|-----------|
| 1 | `qptm_search` | Stage 1 | qPTM database (PHP API) | 1: PTM identification |
| 2 | `qptm_site_conditions` | Stage 1 | qPTM database (PHP API) | 1: PTM identification |
| 3 | `qptm_kinases` | Stage 2 | qPTM database (PHP API) | 1: PTM identification |
| 4 | `iptmnet_enzymes` | Stage 2 | iPTMnet REST API | 2: Writer/Eraser/Reader |
| 5 | `iptmnet_ptm_ppi` | Stage 2/3 | iPTMnet REST API | 3: PTM effects |
| 6 | `uniprot_annotation` | Stage 3 | UniProt REST API | 3: PTM effects |
| 7 | `psp_regulatory` | Stage 3 | PhosphoSitePlus local file | 3/5: PTM effects / cellular process |
| 8 | `dbptm_functional` | Stage 3 | dbPTM local file / web | 6: Disease association |
| 9 | `ptm_stability` | Stage 3 | Curated dataset (PMC9839724) | 3: PTM effects on stability |

### Planned Tools (Direction 3/5/7 extensions)

| Tool | Data Source | Direction | Status |
|------|-------------|-----------|--------|
| `ptm_phase_separation` | PTMPhaSe | 3: PTM effects on phase separation | Planned |
| `ptm_ppi_effect` | PTMint | 3: PTM effects on interactions | Planned |
| `ptm_structural_context` | AlphaFold DB API | 3: Structural context | Planned |
| `deepmvp_prediction` | DeepMVP | 7: AI prediction | Planned |
| `ptm_cellular_process` | PSP ON_PROCESS | 5: Cellular process regulation | Planned |

### 7-Direction PTM Research Framework

| Direction | Description | Coverage |
|-----------|-------------|----------|
| 1 | PTM identification & mapping | qPTM core (tools 1-3) |
| 2 | Writer/Eraser/Reader | iPTMnet (tool 4, partial — writer only) |
| 3 | PTM effects on protein properties | ptm_stability (tool 9) + planned tools |
| 4 | PTM crosstalk | Deferred |
| 5 | PTM regulation of cellular processes | Planned (PSP ON_PROCESS) |
| 6 | PTM & disease | dbPTM/PTMD (tool 8, already integrated by qPTM) |
| 7 | AI & PTM prediction | Planned (DeepMVP) |


## PTM-Stability Curated Dataset

The `ptm_stability` tool (tool 9) uses a manually curated dataset extracted from:

> Batista et al. "Control of protein stability by post-translational modifications." *Nature Communications* 14, 2023. doi:10.1038/s41467-023-35795-8. PMC9839724.

**Dataset statistics:**
- 78 curated PTM-stability relationships
- 34 substrate proteins (UniProt accessions verified)
- 7 PTM types: phosphorylation, methylation, acetylation, ubiquitylation, SUMOylation, hydroxylation, glycosylation
- 39 stabilizing / 39 destabilizing entries
- Each entry includes: effect direction, molecular mechanism, writer/eraser/reader enzymes, ubiquitination sites

**TSV format** (`data/stability/ptm_stability_curated.tsv`):

| Column | Description |
|--------|-------------|
| `uniprot_ac` | UniProt accession (e.g., P04637) |
| `gene` | Gene symbol (e.g., TP53) |
| `ptm_type` | PTM type (phosphorylation, methylation, etc.) |
| `position` | Residue position (- if unspecified) |
| `effect_direction` | stabilize or destabilize |
| `mechanism` | Molecular mechanism description |
| `writer` | Enzyme that writes the modification |
| `eraser` | Enzyme that removes the modification |
| `reader` | Protein that recognizes the modification |
| `ubiquitin_sites` | Lysines targeted for ubiquitination |
| `evidence` | Evidence type (all entries: experimental) |
| `source` | Source reference (PMC9839724) |


## API Endpoints

Apache `/agent-api/*` splits by service:

| Method | Path | Service | Description |
|--------|------|---------|-------------|
| GET | `/health` | runtime :8101 | Runtime + MCP + backend aggregation |
| POST | `/chat` | runtime :8101 | Streaming chat (SSE) |
| POST | `/classify` | runtime :8101 | Intent routing (incl. collection / PXD) |
| GET/POST/DELETE | `/conversations` | runtime :8101 | Per-device conversation history |
| POST | `/reset-session` | runtime :8101 | Clear in-memory + persisted investigation state |
| GET | `/tools` | backend :8100 | List registered Python tools |
| POST | `/collection/...` | backend :8100 | Literature collection jobs |
| POST | `/export/answer-pdf` | backend :8100 | Markdown → PDF |


## Configuration

Environment variables (`.env` file in `agent-backend/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | (required) | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API endpoint |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Model name (DeepSeek V3) |
| `QPTM_API_BASE_URL` | `https://qptm3.omicsbio.info/api` | qPTM PHP API base URL |
| `UNIPROT_API_BASE_URL` | `https://rest.uniprot.org` | UniProt REST API |
| `IPTMNET_API_BASE_URL` | `https://research.bioinformatics.udel.edu/iptmnet/api` | iPTMnet API |
| `PSP_DATA_DIR` | `./data/psp` | PhosphoSitePlus data directory |
| `DBPTM_DATA_DIR` | `./data/dbptm` | dbPTM data directory |
| `STABILITY_DATA_DIR` | `./data/stability` | PTM-stability dataset directory |
| `HOST` | `0.0.0.0` | Backend bind address |
| `PORT` | `8100` | Backend port |
| `CORS_ORIGINS` | `http://localhost,http://qptm3.omicsbio.info` | Allowed CORS origins |