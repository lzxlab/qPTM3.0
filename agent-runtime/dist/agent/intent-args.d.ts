import type { InvestigationMemory } from "../context/memory.js";
export declare const DEFAULT_INTENT_LIMIT = 15;
export declare const MAX_INTENT_LIMIT = 200;
export declare function buildIntentArgs(memory: InvestigationMemory, question: string, extra?: Record<string, unknown> | null): Record<string, unknown>;
