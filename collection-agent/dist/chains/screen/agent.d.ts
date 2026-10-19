import type { AbstractRecord, ScreenResult } from "../../types.js";
import type { LlmRuntime } from "../../runtime.js";
export interface ScreenChainOptions {
    /** Retry once on parse failure (default true) */
    retryOnParseError?: boolean;
    temperature?: number;
}
/**
 * Specialized Stage-1 classification chain.
 * Deterministic I/O: AbstractRecord → ScreenResult
 * (Pi Coding Agent is NOT used here — only ModelRuntime.completeSimple)
 */
export declare class ScreenChain {
    private readonly runtime;
    private readonly options;
    constructor(runtime: LlmRuntime, options?: ScreenChainOptions);
    run(abstract: AbstractRecord): Promise<ScreenResult>;
    private runOnce;
}
