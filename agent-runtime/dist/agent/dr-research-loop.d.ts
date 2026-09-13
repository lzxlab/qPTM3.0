import OpenAI from "openai";
import type { ArtifactStore } from "../context/artifacts.js";
import type { InvestigationMemory } from "../context/memory.js";
import type { SessionState } from "../context/session.js";
import { type QptmToolResult } from "../mcp/hub.js";
import type { AgentEvent } from "../sse.js";
import { type Citation } from "./citations.js";
import { type StepOutcome } from "./tool-result.js";
export interface PlanStep {
    step: number;
    title: string;
    entity: string;
    tools: string[];
    rationale: string;
}
export interface DrResearchState {
    outcomes: StepOutcome[];
    succeededTools: Set<string>;
    emptyTools: Set<string>;
    callBugTools: Set<string>;
    predictedOnlyTools: Set<string>;
    depthSearched: boolean;
    toolsUsed: string[];
}
export declare function createDrState(): DrResearchState;
export declare function executeIntent(tool: string, memory: InvestigationMemory, question: string, retryOnBug?: boolean): Promise<{
    tool: string;
    result: QptmToolResult;
    outcome: StepOutcome;
}>;
export declare function buildPlan(question: string, memory: InvestigationMemory, skills: string, catalog: string, lang: "zh" | "en", state: DrResearchState): Promise<{
    summary: string;
    steps: PlanStep[];
}>;
export declare function commitIntentResult(tool: string, result: QptmToolResult, outcome: StepOutcome, memory: InvestigationMemory, artifacts: ArtifactStore, citations: Citation[], state: DrResearchState): AsyncGenerator<AgentEvent, void>;
export declare function runBreadthPlanExecute(userMessage: string, memory: InvestigationMemory, session: SessionState, skills: string, catalog: string, lang: "zh" | "en", artifacts: ArtifactStore, citations: Citation[], state: DrResearchState): AsyncGenerator<AgentEvent>;
export declare function buildDepthQuery(focus: string, memory: InvestigationMemory, question: string): string;
export declare function runDepthSearch(userMessage: string, memory: InvestigationMemory, session: SessionState, lang: "zh" | "en", artifacts: ArtifactStore, citations: Citation[], state: DrResearchState, focus: string, queryOverride?: string): AsyncGenerator<AgentEvent>;
export declare const SUPERVISOR_META_TOOLS: readonly ["breadth_search", "depth_search", "web_search", "finish_research"];
export declare function buildSupervisorTools(state: DrResearchState): Promise<OpenAI.Chat.ChatCompletionTool[]>;
export declare function runSupervisorLoop(userMessage: string, memory: InvestigationMemory, session: SessionState, skills: string, catalog: string, lang: "zh" | "en", artifacts: ArtifactStore, citations: Citation[], state: DrResearchState): AsyncGenerator<AgentEvent>;
