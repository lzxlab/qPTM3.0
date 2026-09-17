import type { InvestigationMemory } from "../context/memory.js";

export const DEFAULT_INTENT_LIMIT = 15;
export const MAX_INTENT_LIMIT = 200;

export function buildIntentArgs(
  memory: InvestigationMemory,
  question: string,
  extra?: Record<string, unknown> | null,
): Record<string, unknown> {
  const fallbackQuery =
    [memory.gene, memory.position ? `S${memory.position}` : "", memory.ptm_type].filter(Boolean).join(" ") ||
    question;
  const extraQuery = extra?.query != null ? String(extra.query).trim() : "";
  const args: Record<string, unknown> = {
    query: extraQuery || question || fallbackQuery,
    gene: memory.gene || extra?.gene || "",
    position: memory.position || extra?.position || 0,
    uniprot_ac: memory.uniprot_ac || extra?.uniprot_ac || "",
    ptm_type: extra?.ptm_type || memory.ptm_type || "phosphorylation",
    limit: DEFAULT_INTENT_LIMIT,
  };
  if (!extra) return args;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "query") continue;
    if (k === "limit") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) {
        args.limit = Math.min(MAX_INTENT_LIMIT, Math.max(1, Math.floor(n)));
      }
      continue;
    }
    if ((k === "gene" || k === "position" || k === "uniprot_ac") && args[k]) continue;
    args[k] = v;
  }
  return args;
}
