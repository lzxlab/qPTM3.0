import type { AgentEvent } from "../sse.js";
import type { SessionState } from "../context/session.js";

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
} as const;

export type AgentPhaseName = (typeof AgentPhase)[keyof typeof AgentPhase];

export function phaseEvent(phase: AgentPhaseName, label: string): AgentEvent {
  return { type: "phase_update", phase, label };
}

/** Emit phase_update and mirror into session for debugging/tests. */
export function setPhase(session: SessionState, phase: AgentPhaseName, label: string): AgentEvent {
  session.phase = phase;
  return phaseEvent(phase, label);
}
