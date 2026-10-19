import type { LiteratureInfoRow, MetaTextSource } from "../../types.js";
import type { LlmRuntime } from "../../runtime.js";
export interface MetaChainInput {
    pmid: string;
    title: string;
    excerpt: string;
    textSource: MetaTextSource;
    knownIdentifiers: Array<{
        id: string;
        source: string;
    }>;
}
export interface MetaChainOptions {
    retryOnParseError?: boolean;
    /** Extra attempts for stream/timeouts (default 2 → up to 3 total tries). */
    maxTransientRetries?: number;
    temperature?: number;
}
/** Transient provider/stream failures that often succeed on retry. */
export declare function isTransientMetaLlmError(err: unknown): boolean;
/**
 * Specialized Stage-3 metadata extraction chain.
 * Deterministic I/O: paper excerpt → LiteratureInfoRow
 */
export declare class MetaChain {
    private readonly runtime;
    private readonly options;
    constructor(runtime: LlmRuntime, options?: MetaChainOptions);
    run(input: MetaChainInput): Promise<LiteratureInfoRow>;
    private runOnce;
}
