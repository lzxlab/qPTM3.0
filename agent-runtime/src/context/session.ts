import { InvestigationMemory, emptyMemory } from "./memory.js";
import { ArtifactStore } from "./artifacts.js";
import type { Citation } from "../agent/citations.js";
import { AgentPhase, type AgentPhaseName } from "../agent/phase.js";

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

const sessions = new Map<string, SessionState>();

function blankSession(sessionId: string): SessionState {
  return {
    sessionId,
    memory: emptyMemory(),
    artifacts: new ArtifactStore(),
    citations: [],
    pendingClarification: null,
    clarifyRound: 0,
    deepResearchBrief: null,
    lastMode: "qa",
    phase: AgentPhase.routing,
    turnCount: 0,
  };
}

export function applyPersistedSession(session: SessionState, data: PersistedSession): void {
  if (data.memory) session.memory = { ...emptyMemory(), ...data.memory };
  session.citations = Array.isArray(data.citations) ? data.citations : [];
  session.pendingClarification = data.pendingClarification ?? null;
  session.clarifyRound = Number(data.clarifyRound) || 0;
  session.deepResearchBrief = data.deepResearchBrief ?? null;
  session.lastMode = data.lastMode === "deep_research" ? "deep_research" : "qa";
  if (Array.isArray(data.artifacts)) session.artifacts.load(data.artifacts);
}

export function sessionToPersisted(session: SessionState): PersistedSession {
  return {
    memory: session.memory,
    citations: session.citations,
    pendingClarification: session.pendingClarification,
    clarifyRound: session.clarifyRound,
    deepResearchBrief: session.deepResearchBrief,
    lastMode: session.lastMode,
    artifacts: session.artifacts.toJSON(),
  };
}

export function getOrCreateSession(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = blankSession(sessionId);
    sessions.set(sessionId, s);
  }
  return s;
}

export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}
