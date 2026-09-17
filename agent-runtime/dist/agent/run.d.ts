import type { AgentEvent } from "../sse.js";
import { type PersistedSession } from "../context/session.js";
export type AgentMode = "qa" | "deep_research";
export interface RunAgentOptions {
    message: string;
    sessionId: string;
    conversationId?: string;
    history: Array<{
        role: string;
        content: string;
    }>;
    mode: AgentMode;
}
export declare function runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent>;
export declare function snapshotSession(sessionId: string, conversationId?: string): PersistedSession | null;
export declare function newSessionId(): string;
