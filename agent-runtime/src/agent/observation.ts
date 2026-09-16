import type { ArtifactPayload } from "../context/artifacts.js";
import type { QptmToolResult } from "../mcp/hub.js";
import { toStepOutcome } from "./tool-result.js";

const ENTITY_KEYS = [
  "kinase_gene",
  "kinase",
  "KINASE",
  "gene",
  "name",
  "cell_line",
  "cell_type",
  "organism",
  "condition",
  "treatment",
];

export function emptyCallKey(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    tool,
    query: args.query ?? "",
    gene: args.gene ?? "",
    position: args.position ?? 0,
    uniprot_ac: args.uniprot_ac ?? "",
    ptm_type: args.ptm_type ?? "",
    limit: args.limit ?? "",
    sources: args.sources ?? "",
    pmids: args.pmids ?? "",
    fulltext_pmids: args.fulltext_pmids ?? "",
  });
}

export function followableEntitiesFromPayload(
  payload: ArtifactPayload | undefined,
  exclude: string[] = [],
  max = 8,
): string[] {
  const skip = new Set(exclude.map((e) => e.toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const names: string[] = [];
  for (const b of payload?.blocks || []) {
    for (const r of b.rows) {
      for (const k of ENTITY_KEYS) {
        const n = String(r[k] || "").trim();
        const key = n.toLowerCase();
        if (!n || n.length < 2 || n.length > 24 || skip.has(key) || seen.has(key)) continue;
        if (/^\d+$/.test(n)) continue;
        seen.add(key);
        names.push(n);
        if (names.length >= max) return names;
      }
    }
  }
  return names;
}

function truncationTags(payload: ArtifactPayload | undefined): string[] {
  const tags: string[] = [];
  for (const b of payload?.blocks || []) {
    if (b.truncated || (b.total > 0 && b.shown > 0 && b.total > b.shown)) {
      tags.push(`[truncated, shown=${b.shown}, total=${b.total}${b.source ? `, source=${b.source}` : ""}]`);
    }
  }
  return tags;
}

/** Honest tool observation for the ReAct scheduler (not user-visible). */
export function formatToolObservation(
  tool: string,
  result: QptmToolResult,
  payload?: ArtifactPayload,
  extraEntities: string[] = [],
  excludeEntities: string[] = [],
): string {
  const outcome = toStepOutcome(tool, result);
  const tags: string[] = [];
  if (outcome.empty) tags.push("[empty_result]");
  if (outcome.callBug) tags.push("[call_bug]");
  if (result.error_kind && result.error_kind !== "empty_result" && result.error_kind !== "call_bug") {
    tags.push(`[${result.error_kind}]`);
  }
  if (outcome.predictedOnly) tags.push("[predicted_only]");
  tags.push(...truncationTags(payload));
  if (!outcome.success && !tags.length) tags.push("[tool_error]");

  const entities = [
    ...followableEntitiesFromPayload(payload, excludeEntities),
    ...extraEntities.filter(Boolean),
  ];
  const uniqueEntities = [...new Set(entities)].slice(0, 8);
  const entityLine = uniqueEntities.length
    ? `Followable entities: ${uniqueEntities.join(", ")}`
    : "";

  const parts = [
    tags.join(" ").trim(),
    (result.summary || "").slice(0, 1200),
    entityLine,
  ].filter(Boolean);
  return parts.join("\n").slice(0, 2500);
}

export function hasSubstantialEvidence(opts: {
  dbRowCount: number;
  literatureCount: number;
}): boolean {
  return opts.dbRowCount > 0 || opts.literatureCount > 0;
}
