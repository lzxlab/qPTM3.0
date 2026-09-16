import type { InvestigationMemory } from "../context/memory.js";
import type { QptmToolResult } from "../mcp/hub.js";

export type LitPaper = {
  pmid: string;
  title: string;
  abstract: string;
  fulltext?: string;
  score?: number;
};

const PMID_LABELED = /PMID[:\s]*(\d{7,8})/gi;

export function extractPmids(text: string, max = 10): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    if (!id || seen.has(id) || out.length >= max) return;
    seen.add(id);
    out.push(id);
  };
  const src = String(text || "");
  for (const m of src.matchAll(PMID_LABELED)) add(m[1]);
  if (out.length < max) {
    for (const m of src.matchAll(/"pmid"\s*:\s*"?(\d{7,8})"?/gi)) add(m[1]);
  }
  return out;
}

function rowPmid(row: Record<string, unknown>): string {
  const raw = String(row.pmid || row.PMID || "").trim();
  return /^\d{7,8}$/.test(raw) ? raw : "";
}

export function papersFromToolResult(result: QptmToolResult | null | undefined): LitPaper[] {
  const out: LitPaper[] = [];
  const seen = new Set<string>();
  const blocks = result?.blocks;
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const rows = (block as { rows?: unknown[] }).rows;
      if (!Array.isArray(rows)) continue;
      for (const raw of rows) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Record<string, unknown>;
        const pmid = rowPmid(row);
        if (!pmid || seen.has(pmid)) continue;
        seen.add(pmid);
        out.push({
          pmid,
          title: String(row.title || ""),
          abstract: String(row.abstract || ""),
          fulltext: row.fulltext ? String(row.fulltext) : undefined,
        });
      }
    }
  }
  if (!out.length && result?.summary) {
    for (const pmid of extractPmids(result.summary, 20)) {
      out.push({ pmid, title: "", abstract: "" });
    }
  }
  return out;
}

export function geneLikeTokens(text: string, exclude: string[] = [], max = 8): string[] {
  const skip = new Set(
    ["DNA", "RNA", "PTM", "PMID", "PMC", "OA", "THE", "AND", "FOR", "WITH", "FROM", "CELL", "HUMAN", "SITE"].concat(
      exclude.map((e) => e.toUpperCase()),
    ),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of String(text || "").matchAll(/\b([A-Z][A-Z0-9]{1,7})\b/g)) {
    const tok = m[1];
    if (skip.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeLitQuery(q: string): string {
  return String(q || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function entitiesMissingFromQuery(query: string, entities: string[]): string[] {
  const q = normalizeLitQuery(query);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entities) {
    const e = String(raw || "").trim();
    if (!e || e.length < 2) continue;
    const key = e.toLowerCase();
    if (seen.has(key) || q.includes(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function withFrontierEntities(query: string, entities: string[], max = 3): string {
  const add = entitiesMissingFromQuery(query, entities).slice(0, max);
  const base = String(query || "").trim();
  if (!add.length) return base;
  return `${base} ${add.join(" ")}`.trim();
}

export function literatureTokens(
  memory: Pick<InvestigationMemory, "gene" | "position" | "ptm_type">,
  focus = "",
  question = "",
): string[] {
  const raw = [
    memory.gene || "",
    memory.position ? String(memory.position) : "",
    memory.position ? `s${memory.position}` : "",
    memory.ptm_type,
    focus,
    question,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const toks = raw.match(/[a-z0-9]{2,}/g) || [];
  return [...new Set(toks)];
}

export function rankLiteraturePapers(
  papers: LitPaper[],
  tokens: string[],
  gene?: string | null,
): LitPaper[] {
  const geneTok = (gene || "").toLowerCase();
  const scored = papers.map((p) => {
    const blob = `${p.title} ${p.abstract}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (t.length < 2) continue;
      if (blob.includes(t)) score += t === geneTok ? 3 : 1;
    }
    return { ...p, score };
  });
  scored.sort((a, b) => (b.score || 0) - (a.score || 0));
  const min = geneTok ? 2 : 1;
  return scored.filter((p) => (p.score || 0) >= min);
}

export function papersNeedAbstracts(papers: LitPaper[]): boolean {
  if (!papers.length) return true;
  return !papers.some((p) => Boolean(p.abstract && p.abstract.trim()));
}

export function mergeLiteratureResults(
  search: QptmToolResult,
  abstracts: QptmToolResult,
): QptmToolResult {
  const blocks = [...(Array.isArray(search.blocks) ? search.blocks : []), ...(Array.isArray(abstracts.blocks) ? abstracts.blocks : [])];
  const papers = papersFromToolResult(abstracts);
  const absCount = papers.filter((p) => p.abstract?.trim()).length;
  const summary = [search.summary, abstracts.summary, absCount ? `Fetched ${absCount} abstract(s)` : ""]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 800);
  const ok = Boolean(search.success || abstracts.success);
  return {
    success: ok,
    summary,
    data: abstracts.data ?? search.data,
    blocks,
    intent: "search_literature",
    error_kind: ok ? null : abstracts.error_kind || search.error_kind || "empty_result",
    missing: abstracts.missing?.length ? abstracts.missing : search.missing,
    resolved: abstracts.resolved || search.resolved,
  };
}
