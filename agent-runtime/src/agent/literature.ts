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
