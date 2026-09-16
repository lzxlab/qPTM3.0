import type { SessionState } from "../context/session.js";
import type { AgentEvent } from "../sse.js";
export declare function runReactLoop(userMessage: string, history: Array<{
    role: string;
    content: string;
}>, session: SessionState): AsyncGenerator<AgentEvent>;
