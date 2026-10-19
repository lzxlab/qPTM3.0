import { type CollectionJobState, type StageName } from "./job-state.js";
export interface RunCollectionJobOptions {
    jobId: string;
    outDir: string;
    pmid: string;
    fulltextPath?: string;
    supplementaryPath?: string;
    supplementaryPaths?: string[];
    resumeFrom?: StageName | "auto";
    /** Bypass Stage-1 LLM exclude and force-include this PMID (user override). */
    forceInclude?: boolean;
    concurrency?: number;
    model?: string;
    onLog?: (msg: string) => void;
}
export declare function runCollectionJob(options: RunCollectionJobOptions): Promise<CollectionJobState>;
