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
export declare function toStepOutcome(tool: string, result: QptmToolResult): StepOutcome;
