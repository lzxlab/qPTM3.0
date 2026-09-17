export type AgentEventType = "text" | "tool_call" | "tool_result" | "phase_update" | "sources" | "follow_up_questions" | "done" | "error" | "literature_search" | "report_thought";
export interface AgentEvent {
    type: AgentEventType | string;
    [key: string]: unknown;
}
export declare function sseFormat(event: string, data: Record<string, unknown>): string;
export declare function agentEventToSse(event: AgentEvent): string | null;
