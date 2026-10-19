import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
export interface LlmRuntime {
    cwd: string;
    agentDir: string;
    modelRuntime: ModelRuntime;
    model: Model<any>;
    /** Resolved models in preference order (primary first). */
    models: Model<any>[];
    modelId: string;
}
export declare function loadDotEnv(cwd?: string): void;
/** Parse "opencode-go/deepseek-v4-flash" or bare "deepseek-v4-flash" */
export declare function parseModelId(modelId: string): {
    provider: string;
    modelName: string;
};
/**
 * Prefer OpenCode Go when:
 * - MODEL already says opencode-go/…, or
 * - OPENCODE_API_KEY is set and DEEPSEEK_API_KEY is not (for DeepSeek V4 ids)
 */
export declare function resolveModelId(rawModelId: string): string;
/** Primary MODEL plus MODEL_FALLBACKS (deduped, resolved). */
export declare function modelCandidateIds(primaryRaw?: string): string[];
export declare function createLlmRuntime(options?: {
    model?: string;
    cwd?: string;
}): Promise<LlmRuntime>;
type CompleteSimpleArgs = Parameters<ModelRuntime["completeSimple"]>;
/**
 * Call completeSimple on the primary model, then fallbacks on failure.
 */
export declare function completeSimpleWithFallback(runtime: LlmRuntime, context: CompleteSimpleArgs[1], options?: CompleteSimpleArgs[2]): Promise<Awaited<ReturnType<ModelRuntime["completeSimple"]>>>;
export declare function assistantText(message: {
    content: Array<{
        type: string;
        text?: string;
    }>;
    errorMessage?: string;
    stopReason?: string;
}): string;
export {};
