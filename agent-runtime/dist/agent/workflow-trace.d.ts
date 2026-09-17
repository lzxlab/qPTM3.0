import type { AgentEvent } from "../sse.js";
export interface WorkflowPhaseItem {
    id: string;
    label: string;
    status: string;
    ts: number;
    detail?: string;
}
export interface WorkflowPlanStep {
    step: number;
    title: string;
    description: string;
    rationale: string;
    database: string;
    tools: string[];
    status: string;
}
export interface WorkflowToolRow {
    tool_name: string;
    kind: string;
    status: string;
    summary: string;
    arguments: Record<string, unknown>;
    error_kind?: string;
    ts: number;
}
export interface WorkflowStateSnapshot {
    goal: string;
    currentPhase: string;
    status: string;
    phases: WorkflowPhaseItem[];
    plan: {
        summary: string;
        steps: WorkflowPlanStep[];
    };
    tools: WorkflowToolRow[];
    literature: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
    decision: Record<string, unknown> | null;
    supervisor: Array<Record<string, unknown>>;
    synthesis: {
        thought: string;
    };
}
export declare function emptyWorkflowState(): WorkflowStateSnapshot;
export declare function applyAgentEvent(state: WorkflowStateSnapshot, event: AgentEvent): void;
export declare function workflowHasData(state: WorkflowStateSnapshot): boolean;
/** Invariant helper: only `text` events belong in the saved/shown answer. */
export declare function appendAnswerText(fullAnswer: string, event: AgentEvent): string;
