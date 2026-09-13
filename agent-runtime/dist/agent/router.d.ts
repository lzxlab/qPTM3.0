import type { QueryMode } from "./gate.js";
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
export declare function isSpecificEnough(memory: InvestigationMemory): boolean;
/** Pure routing — no I/O. Mirrors run.ts investigation vs direct-answer split. */
export declare function routeQuery(input: RouteInput): RouteDecision;
