import { InvestigationMemory } from "./memory.js";
import { ArtifactStore } from "./artifacts.js";
import type { Citation } from "../agent/citations.js";
import { type AgentPhaseName } from "../agent/phase.js";
export interface SessionState {
    sessionId: string;
    memory: InvestigationMemory;
    artifacts: ArtifactStore;
    citations: Citation[];
    pendingClarification: Record<string, unknown> | null;
    /** How many clarification rounds already completed in this deep-research thread. */
    clarifyRound: number;
    /** Accumulated question + clarification answers for multi-round clarify. */
    deepResearchBrief: string | null;
    lastMode: "qa" | "deep_research";
    /** In-memory lifecycle phase (not persisted to SQLite in this iteration). */
    phase: AgentPhaseName;
    turnCount: number;
}
export type PersistedSession = {
    memory: InvestigationMemory;
    citations: Citation[];
    pendingClarification: Record<string, unknown> | null;
    clarifyRound: number;
    deepResearchBrief: string | null;
    lastMode: "qa" | "deep_research";
    artifacts: ReturnType<ArtifactStore["toJSON"]>;
};
export declare function applyPersistedSession(session: SessionState, data: PersistedSession): void;
export declare function sessionToPersisted(session: SessionState): PersistedSession;
export declare function getOrCreateSession(sessionId: string): SessionState;
export declare function resetSession(sessionId: string): void;
