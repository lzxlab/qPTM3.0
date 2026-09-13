import type { QueryMode } from "./gate.js";
import { shouldSkipInvestigation } from "./gate.js";
import type { InvestigationMemory } from "../context/memory.js";

export type RouteHandler = "qa_direct" | "clarify" | "investigate";

export interface RouteInput {
  queryMode: QueryMode;
  clarificationResponse?: {
    skip?: boolean;
    selections?: Record<string, string>;
    free_text?: string;
  } | null;
  memory: InvestigationMemory;
  clarifyRound: number;
  maxClarifyRounds: number;
  skippedClarify?: boolean;
}

export interface RouteDecision {
  handler: RouteHandler;
  /** True when clarify path is eligible (LLM may still decide no fields needed). */
  mayClarify: boolean;
  specificEnough: boolean;
}

export function isSpecificEnough(memory: InvestigationMemory): boolean {
  return Boolean((memory.gene || memory.uniprot_ac) && memory.position);
}

/** Pure routing — no I/O. Mirrors run.ts investigation vs direct-answer split. */
export function routeQuery(input: RouteInput): RouteDecision {
  const specificEnough = isSpecificEnough(input.memory);
  const skippedClarify = Boolean(input.skippedClarify);

  if (!input.clarificationResponse && shouldSkipInvestigation(input.queryMode)) {
    return { handler: "qa_direct", mayClarify: false, specificEnough };
  }

  const mayClarify =
    !skippedClarify && !specificEnough && input.clarifyRound < input.maxClarifyRounds;

  if (mayClarify) {
    return { handler: "clarify", mayClarify: true, specificEnough };
  }

  return { handler: "investigate", mayClarify: false, specificEnough };
}
