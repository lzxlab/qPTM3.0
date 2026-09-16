import type { ArtifactStore } from "../context/artifacts.js";
import { type InvestigationMemory } from "../context/memory.js";
import { type Citation } from "./citations.js";
export type ComposeChunk = {
    kind: "text" | "reasoning";
    content: string;
};
/** Compact clues for the answer writer — not an inventory to copy. */
export declare function cluesForComposer(memory: InvestigationMemory, artifacts: ArtifactStore, maxChars?: number): string;
export declare function composeSystemPrompt(citeList: string): string;
export declare function composeAnswer(question: string, history: Array<{
    role: string;
    content: string;
}>, memory: InvestigationMemory, artifacts: ArtifactStore, citations: Citation[]): AsyncGenerator<ComposeChunk>;
