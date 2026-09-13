/** Canonical agent lifecycle phases (SSE phase_update.phase). */
export const AgentPhase = {
    routing: "routing",
    clarifying: "clarifying",
    supervising: "supervising",
    breadth: "breadth",
    depth: "depth",
    planning: "planning",
    retrieving_tools: "retrieving_tools",
    database: "database",
    literature: "literature",
    synthesis: "synthesis",
};
export function phaseEvent(phase, label) {
    return { type: "phase_update", phase, label };
}
/** Emit phase_update and mirror into session for debugging/tests. */
export function setPhase(session, phase, label) {
    session.phase = phase;
    return phaseEvent(phase, label);
}
