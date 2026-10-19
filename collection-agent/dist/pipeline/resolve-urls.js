/**
 * Orchestrate standalone resolve-urls jobs (accession → MS download links).
 * Writes Stage6 artifacts + a job.json the UI / API can poll.
 */
import { existsSync } from "node:fs";
import { pmidForOutput } from "../stage6/naming.js";
import { loadDotEnv } from "../runtime.js";
import { setDataRoot, stage6UrlsAllPath } from "../utils/io.js";
import { patchJobState } from "./job-state.js";
import { runResolveUrlsByAccession, } from "./stage6.js";
export async function runResolveUrlsJob(options) {
    loadDotEnv();
    setDataRoot(options.outDir);
    const log = options.onLog ?? (() => { });
    const accessions = options.accessions.map((a) => a.trim().toUpperCase()).filter(Boolean);
    const displayId = accessions.join("; ") || "unknown";
    // Job identity may show the accession for accession-only resolves; CSV PMID stays empty unless real.
    const realPmid = pmidForOutput(options.pmid);
    const jobKey = realPmid || accessions[0] || "";
    let state = patchJobState(options.outDir, {
        jobId: options.jobId,
        pmid: jobKey,
        status: "running",
        currentStage: "stage6",
        nextStage: null,
        awaitingUpload: null,
        message: `Resolving MS download URLs for ${displayId}…`,
        stages: { stage6: "running" },
        summary: {
            resolveUrls: true,
            accessions,
            stage6Thinking: [
                { step: "start", message: "Starting standalone URL resolution" },
                { step: "resolve", message: `Querying repositories for ${displayId}…` },
            ],
        },
    });
    try {
        const summary = await runResolveUrlsByAccession({
            accessions,
            pmid: realPmid || undefined,
            title: options.title,
            organism: options.organism,
            modification: options.modification,
            getUrlDir: options.getUrlDir,
            onLog: log,
        });
        const hasUrls = existsSync(stage6UrlsAllPath());
        const total = summary.totalUrls;
        const result = summary.results[0];
        const statusNote = result?.error ? `Note: ${result.error}` : undefined;
        const message = [
            `MS repository download links have been resolved for ${displayId}.`,
            `Found ${total} download URL(s).`,
            statusNote,
            hasUrls ? "Download MS_URLs.csv below." : undefined,
        ]
            .filter(Boolean)
            .join("\n");
        state = patchJobState(options.outDir, {
            jobId: options.jobId,
            pmid: jobKey,
            status: "completed",
            currentStage: "stage6",
            nextStage: null,
            awaitingUpload: null,
            offerContribute: false,
            message,
            stages: { stage6: result?.status === "error" ? "failed" : "completed" },
            summary: {
                resolveUrls: true,
                accessions,
                stage6: {
                    ...summary,
                    identifier: displayId,
                    totalUrls: total,
                },
                stage6Thinking: [
                    { step: "start", message: "Starting standalone URL resolution" },
                    { step: "resolve", message: `Querying repositories for ${displayId}…` },
                    { step: "result", message: `Found ${total} download URL(s)` },
                ],
                artifacts: {
                    fulltextKind: null,
                    hasSupplementary: false,
                    hasQratio: false,
                    hasMsUrls: hasUrls,
                    fulltextUserUpload: false,
                    supplementaryUserUpload: false,
                },
            },
        });
        return state;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`resolve-urls error: ${message}`);
        return patchJobState(options.outDir, {
            jobId: options.jobId,
            pmid: jobKey,
            status: "error",
            currentStage: "stage6",
            error: message,
            message: `URL resolution failed: ${message}`,
            stages: { stage6: "failed" },
            summary: {
                resolveUrls: true,
                accessions,
            },
        });
    }
}
