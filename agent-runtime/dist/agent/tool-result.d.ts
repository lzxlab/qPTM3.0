import type { QptmToolResult } from "../mcp/hub.js";
export type StepOutcome = {
    tool: string;
    success: boolean;
    empty: boolean;
    callBug: boolean;
    predictedOnly: boolean;
    error_kind?: string | null;
    summary: string;
};
export declare function isEmptyToolResult(result: {
    success?: boolean;
    error_kind?: string | null;
}): boolean;
export declare function isCallBug(result: {
    error_kind?: string | null;
}): boolean;
export declare function toStepOutcome(tool: string, result: QptmToolResult): StepOutcome;
export declare function gapScore(outcomes: StepOutcome[]): number;
export declare function wantsIntentExpand(args?: Record<string, unknown> | null): boolean;
export declare function mayRecallIntent(tool: string, emptyTools: ReadonlySet<string>, succeededTools: ReadonlySet<string>, opts?: {
    expand?: boolean;
}): boolean;
export declare function outcomesSummary(outcomes: StepOutcome[]): string;
