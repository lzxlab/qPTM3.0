import { SessionState } from "../context/session.js";
import type { AgentEvent } from "../sse.js";
export declare function runDeepResearch(userMessage: string, history: Array<{
    role: string;
    content: string;
}>, session: SessionState): AsyncGenerator<AgentEvent>;
export type ReportStreamChunk = {
    kind: "text" | "reasoning";
    content: string;
};
