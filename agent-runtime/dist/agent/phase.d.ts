import type { AgentEvent } from "../sse.js";
import type { SessionState } from "../context/session.js";
/** Canonical agent lifecycle phases (SSE phase_update.phase). */
export declare const AgentPhase: {
    readonly routing: "routing";
    readonly clarifying: "clarifying";
    readonly supervising: "supervising";
    readonly breadth: "breadth";
    readonly depth: "depth";
    readonly planning: "planning";
    readonly retrieving_tools: "retrieving_tools";
    readonly database: "database";
    readonly literature: "literature";
    readonly synthesis: "synthesis";
};
export type AgentPhaseName = (typeof AgentPhase)[keyof typeof AgentPhase];
export declare function phaseEvent(phase: AgentPhaseName, label: string): AgentEvent;
/** Emit phase_update and mirror into session for debugging/tests. */
export declare function setPhase(session: SessionState, phase: AgentPhaseName, label: string): AgentEvent;
