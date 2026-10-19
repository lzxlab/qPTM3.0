import { type CollectionJobState } from "./job-state.js";
export interface RunResolveUrlsJobOptions {
    jobId: string;
    outDir: string;
    accessions: string[];
    pmid?: string;
    title?: string;
    organism?: string;
    modification?: string;
    getUrlDir?: string;
    onLog?: (msg: string) => void;
}
export declare function runResolveUrlsJob(options: RunResolveUrlsJobOptions): Promise<CollectionJobState>;
