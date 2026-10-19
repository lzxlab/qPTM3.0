/**
 * Job state file for UI / API polling (written beside per-job outDir).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const STAGE_ORDER = [
    "stage1",
    "stage2",
    "stage3",
    "stage4",
    "stage5",
    "stage6",
];
export function jobStatePath(outDir) {
    return join(outDir, "job.json");
}
export function readJobState(outDir) {
    const path = jobStatePath(outDir);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
export function writeJobState(outDir, state) {
    mkdirSync(outDir, { recursive: true });
    const next = {
        ...state,
        updatedAt: new Date().toISOString(),
    };
    writeFileSync(jobStatePath(outDir), JSON.stringify(next, null, 2), "utf8");
}
export function patchJobState(outDir, patch) {
    const prior = readJobState(outDir);
    const merged = {
        jobId: patch.jobId,
        pmid: patch.pmid,
        status: patch.status ?? prior?.status ?? "pending",
        // Allow explicit null to clear stage pointers (do not use ?? — null would keep prior)
        currentStage: patch.currentStage !== undefined ? patch.currentStage : (prior?.currentStage ?? null),
        nextStage: patch.nextStage !== undefined ? patch.nextStage : (prior?.nextStage ?? null),
        awaitingUpload: patch.awaitingUpload !== undefined ? patch.awaitingUpload : (prior?.awaitingUpload ?? null),
        message: patch.message ?? prior?.message ?? "",
        stages: { ...(prior?.stages ?? {}), ...(patch.stages ?? {}) },
        summary: { ...(prior?.summary ?? {}), ...(patch.summary ?? {}) },
        offerContribute: patch.offerContribute !== undefined
            ? patch.offerContribute
            : prior?.offerContribute,
        contribution: patch.contribution !== undefined ? patch.contribution : prior?.contribution,
        error: patch.error !== undefined ? patch.error : prior?.error,
        updatedAt: new Date().toISOString(),
    };
    writeJobState(outDir, merged);
    return merged;
}
export function nextStageAfter(stage) {
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx < 0 || idx >= STAGE_ORDER.length - 1)
        return null;
    return STAGE_ORDER[idx + 1];
}
export function shouldRunStage(resumeFrom, stage) {
    if (resumeFrom === "auto")
        return true;
    const fromIdx = STAGE_ORDER.indexOf(resumeFrom);
    const stageIdx = STAGE_ORDER.indexOf(stage);
    if (fromIdx < 0)
        return true;
    return stageIdx >= fromIdx;
}
