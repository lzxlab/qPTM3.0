export type JobStatus = "pending" | "running" | "awaiting_continue" | "awaiting_upload" | "completed" | "rejected" | "error";
export type AwaitingUpload = "fulltext" | "supplementary";
export type StageName = "stage1" | "stage2" | "stage3" | "stage4" | "stage5" | "stage6";
export declare const STAGE_ORDER: StageName[];
export interface CollectionJobState {
    jobId: string;
    pmid: string;
    status: JobStatus;
    currentStage: StageName | null;
    /** Stage to run when the user clicks Continue */
    nextStage: StageName | null;
    awaitingUpload: AwaitingUpload | null;
    message: string;
    stages: Partial<Record<StageName, "pending" | "running" | "completed" | "skipped" | "failed">>;
    summary: Record<string, unknown>;
    /** Ask user to contribute curated tables to qPTM after a successful parse */
    offerContribute?: boolean;
    contribution?: {
        willing: boolean | null;
        respondedAt?: string;
        note?: string;
    };
    error?: string;
    updatedAt: string;
}
export declare function jobStatePath(outDir: string): string;
export declare function readJobState(outDir: string): CollectionJobState | null;
export declare function writeJobState(outDir: string, state: CollectionJobState): void;
export declare function patchJobState(outDir: string, patch: Partial<CollectionJobState> & {
    jobId: string;
    pmid: string;
}): CollectionJobState;
export declare function nextStageAfter(stage: StageName): StageName | null;
export declare function shouldRunStage(resumeFrom: StageName | "auto", stage: StageName): boolean;
