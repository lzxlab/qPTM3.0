import { InvestigationMemory } from "../context/memory.js";
import { ArtifactStore } from "../context/artifacts.js";
export interface FollowUpQuestion {
    text: string;
    intent: "qa" | "deep_research";
}
/** Concept / refuse / greeting — chips that land on concrete PTM site questions. */
export declare function ptmSteerFollowUps(): FollowUpQuestion[];
export declare function generateFollowUps(question: string, answer: string, memory: InvestigationMemory, artifacts: ArtifactStore, mode: "qa" | "deep_research", toolsUsed: string[]): Promise<FollowUpQuestion[]>;
