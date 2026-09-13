# qPTM Agent Runtime (TypeScript)

TypeScript agent for Q&A and Deep Research. Replaces Python `/chat` when deployed per `deploy/apache-agent-runtime.conf`.

## Requirements

- Node.js >= 22.19 (`/opt/node22/bin/node`)
- Python venv at `agent-backend/.venv` for qPTM MCP stdio server

## Setup

```bash
cd agent-runtime
cp .env.example .env
# Copy DEEPSEEK_API_KEY from agent-backend/.env

export PATH=/opt/node22/bin:$PATH
npm install
npm run build
```

## Run

```bash
export PATH=/opt/node22/bin:$PATH
node dist/index.js
# Listens on PORT (default 8101)
```

## Routing

The agent classifies each question and chooses the path (the UI no longer toggles Q&A vs Deep Research):

- **Direct answer** — greetings, help, capabilities, biology concept questions (`what is / 什么是`), and polite refusals for non-biology topics. Biology concepts and refusals end by steering the user toward a concrete PTM site question.
- **Investigation** — gene/site, mechanism, literature, and other evidence-seeking PTM questions: optional clarification (skipped when gene/UniProt **and** site are already known) → multi-database plan → report.

`mode` in the `/chat` body is accepted for compatibility but does not select the path.

## MCP

- **qPTM MCP**: `agent-backend/mcp_stdio_server.py` (stdio, wraps existing Python tools)
- **BioMCP**: optional `biomcp serve` if installed; falls back to CLI

## Apache cutover

See `deploy/apache-agent-runtime.conf` — routes `/agent-api/chat`, `/conversations`, `/classify` to :8101; `/collection` stays on Python :8100.
