import { SessionState } from "../context/session.js";
import type { AgentEvent } from "../sse.js";
import { type Citation } from "./citations.js";
import { composeAnswer, type ComposeChunk } from "./compose-answer.js";
export declare function runDeepResearch(userMessage: string, history: Array<{
    role: string;
    content: string;
}>, session: SessionState): AsyncGenerator<AgentEvent>;
/** @deprecated Chat uses composeAnswer. Kept as a thin wrapper for leftover callers. */
export type ReportStreamChunk = ComposeChunk;
export declare function streamDeepReport(question: string, history: Array<{
    role: string;
    content: string;
}>, memory: Parameters<typeof composeAnswer>[2], artifacts: Parameters<typeof composeAnswer>[3], _skills: string, _catalog: string, citations: Citation[], _lang: "zh" | "en"): AsyncGenerator<ReportStreamChunk>;
