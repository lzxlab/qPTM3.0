import { emptyMemory } from "./memory.js";
import { ArtifactStore } from "./artifacts.js";
import { AgentPhase } from "../agent/phase.js";
const sessions = new Map();
function blankSession(sessionId) {
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
export function applyPersistedSession(session, data) {
    if (data.memory)
        session.memory = { ...emptyMemory(), ...data.memory };
    session.citations = Array.isArray(data.citations) ? data.citations : [];
    session.pendingClarification = data.pendingClarification ?? null;
    session.clarifyRound = Number(data.clarifyRound) || 0;
    session.deepResearchBrief = data.deepResearchBrief ?? null;
    session.lastMode = data.lastMode === "deep_research" ? "deep_research" : "qa";
    if (Array.isArray(data.artifacts))
        session.artifacts.load(data.artifacts);
}
export function sessionToPersisted(session) {
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
export function getOrCreateSession(sessionId) {
    let s = sessions.get(sessionId);
    if (!s) {
        s = blankSession(sessionId);
        sessions.set(sessionId, s);
    }
    return s;
}
export function resetSession(sessionId) {
    sessions.delete(sessionId);
}
