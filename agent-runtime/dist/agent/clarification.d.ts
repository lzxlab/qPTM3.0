import { InvestigationMemory } from "../context/memory.js";
import type { AgentEvent } from "../sse.js";
export interface ClarificationOption {
    label: string;
    description?: string;
}
export interface ClarificationField {
    id: string;
    label: string;
    /** Short question under the field title. */
    prompt?: string;
    options: ClarificationOption[];
    allow_custom?: boolean;
    placeholder?: string;
}
export interface ClarificationPayload {
    needs_clarification: boolean;
    intro?: string;
    fields?: ClarificationField[];
    free_text?: {
        label: string;
        placeholder: string;
    };
    submit_label?: string;
    skip_label?: string;
}
/** No protein identity and the question needs a specific site — empty-DB investigation is useless. */
export declare function cannotInvestigateSiteLevel(memory: Pick<InvestigationMemory, "gene" | "uniprot_ac">, message: string): boolean;
export interface ClarifyRoundOpts {
    /** Completed clarification rounds so far (0 = first ask). */
    round?: number;
    maxRounds?: number;
}
/**
 * Agent-generated clarification: judge what is still ambiguous,
 * then propose 1–3 targeted questions — may run across multiple rounds.
 */
export declare function buildDeepResearchClarification(message: string, memory?: InvestigationMemory, roundOpts?: ClarifyRoundOpts): Promise<ClarificationPayload>;
export declare function mergeClarification(original: string, selections: Record<string, string>, freeText: string): string;
/** Fold clarification choices into memory (site labels, organism, etc.). */
export declare function applyClarificationToMemory(memory: InvestigationMemory, selections: Record<string, string>, freeText: string): void;
export declare function clarificationEvent(payload: ClarificationPayload): AgentEvent;
