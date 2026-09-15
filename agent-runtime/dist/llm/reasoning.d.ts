/** Read-only extraction of model reasoning already present on API payloads. */
export declare function extractReasoning(payload: unknown): string;
/** Visible completion is empty unless there is content or tool calls. Reasoning alone is not success. */
export declare function isEmptyLlmResult(content: string, toolCalls: unknown[]): boolean;
