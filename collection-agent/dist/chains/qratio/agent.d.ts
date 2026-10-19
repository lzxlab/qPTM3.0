import type { LlmRuntime } from "../../runtime.js";
import type { ColumnMapping } from "../../stage5/heuristic.js";
import type { SheetInventory } from "../../stage5/tables.js";
export interface QratioMapInput {
    pmid: string;
    title: string;
    ptms: string;
    sample: string;
    condition: string;
    detailCondition: string;
    entryPath: string;
    sheet: SheetInventory;
    /** User-provided curation feedback (free text) to honor when mapping columns. */
    userGuidance?: string;
}
export declare class QratioMapChain {
    private readonly runtime;
    private readonly options;
    constructor(runtime: LlmRuntime, options?: {
        retryOnParseError?: boolean;
        temperature?: number;
    });
    run(input: QratioMapInput): Promise<ColumnMapping & {
        skip: boolean;
    }>;
    private runOnce;
}
