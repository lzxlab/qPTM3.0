import { ScreenChain } from "../chains/screen/agent.js";
import { createLlmRuntime } from "../runtime.js";
import { loadPmidListFromFile, resolveAbstractsForPmids, } from "../stage1/resolve-abstracts.js";
import { appendScreenResults, computeStats, exportIncludePmidsCsv, exportUncertainPmidsCsv, loadAllAbstracts, loadGoldPmids, loadScreenedPmids, removeScreenResultsForPmids, writeForceIncludeFromAbstracts, } from "../utils/io.js";
function getPending(skipGold, sourceFile) {
    const screened = loadScreenedPmids();
    const gold = loadGoldPmids();
    return loadAllAbstracts().filter((a) => {
        if (screened.has(a.pmid))
            return false;
        if (skipGold && gold.has(a.pmid))
            return false;
        if (sourceFile && !a.sourceFile.includes(sourceFile))
            return false;
        return true;
    });
}
function filterPending(records, skipGold) {
    const screened = loadScreenedPmids();
    const gold = loadGoldPmids();
    return records.filter((a) => {
        if (screened.has(a.pmid))
            return false;
        if (skipGold && gold.has(a.pmid))
            return false;
        return true;
    });
}
async function mapPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function runner() {
        while (true) {
            const i = next++;
            if (i >= items.length)
                return;
            results[i] = await worker(items[i], i);
        }
    }
    const n = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: n }, () => runner()));
    return results;
}
/**
 * Bypass ScreenChain: resolve abstracts for PMIDs and write them all as include
 * (for validation / Stage2–5 testing).
 */
export async function runForceInclude(options = {}) {
    const log = options.onLog ?? (() => { });
    const pmidList = [];
    if (options.pmid)
        pmidList.push(options.pmid.trim());
    if (options.pmidsFile)
        pmidList.push(...loadPmidListFromFile(options.pmidsFile));
    if (pmidList.length === 0) {
        throw new Error("--force-include requires --pmid and/or --pmids-file");
    }
    const resolved = await resolveAbstractsForPmids(pmidList, {
        source: options.abstractSource ?? "auto",
        onProgress: log,
    });
    if (resolved.missing.length > 0) {
        log(`Warning: no abstract for ${resolved.missing.length} PMID(s): ${resolved.missing.join(", ")}`);
    }
    if (resolved.records.length === 0) {
        throw new Error("No abstracts resolved; cannot write force-include list");
    }
    const { includeN, path } = writeForceIncludeFromAbstracts(resolved.records);
    log(`force-include: wrote ${includeN} PMID(s) → ${path}`);
    return {
        requested: pmidList.length,
        written: resolved.records.length,
        fromLocal: resolved.fromLocal,
        fetched: resolved.fetched,
        missing: resolved.missing,
        includePath: path,
    };
}
/**
 * Deterministic Stage-1 orchestrator:
 * for each pending abstract → ScreenChain.run → append results (checkpointed)
 */
export async function runStage1Screen(options = {}) {
    const concurrency = Math.max(1, options.concurrency ?? 1);
    const skipGold = options.skipGold ?? false;
    const flushEvery = Math.max(1, options.flushEvery ?? 10);
    const sourceFile = options.sourceFile;
    const log = options.onLog ?? (() => { });
    let abstractsFromLocal;
    let abstractsFetched;
    let abstractsMissing;
    let pending;
    const pmidList = [];
    if (options.pmid)
        pmidList.push(options.pmid.trim());
    if (options.pmidsFile)
        pmidList.push(...loadPmidListFromFile(options.pmidsFile));
    if (options.rescreen && pmidList.length > 0) {
        const removed = removeScreenResultsForPmids(pmidList, { refreshExports: false });
        log(`--rescreen: removed ${removed} prior Stage-1 row(s) for ${pmidList.length} PMID(s)`);
    }
    if (pmidList.length > 0) {
        const resolved = await resolveAbstractsForPmids(pmidList, {
            source: options.abstractSource ?? "auto",
            onProgress: log,
        });
        abstractsFromLocal = resolved.fromLocal;
        abstractsFetched = resolved.fetched;
        abstractsMissing = resolved.missing;
        if (resolved.missing.length > 0) {
            log(`Warning: no abstract for ${resolved.missing.length} PMID(s): ${resolved.missing.join(", ")}`);
        }
        pending = filterPending(resolved.records, skipGold);
        // Explicit PMID mode ignores --file / default pending pool; --all means all listed
        if (!options.all && !options.pmid && options.pmidsFile) {
            const limit = options.limit ?? 20;
            pending = pending.slice(0, limit);
        }
    }
    else {
        pending = getPending(skipGold, sourceFile);
        if (!options.all) {
            const limit = options.limit ?? 20;
            pending = pending.slice(0, limit);
        }
    }
    const runtime = await createLlmRuntime({ model: options.model });
    const chain = new ScreenChain(runtime);
    const buffer = [];
    let writeLock = Promise.resolve();
    let saved = 0;
    let errors = 0;
    let include = 0;
    let exclude = 0;
    let uncertain = 0;
    const flushBuffer = () => {
        if (buffer.length === 0)
            return;
        const chunk = buffer.splice(0, buffer.length);
        writeLock = writeLock.then(() => {
            appendScreenResults(chunk);
        });
    };
    const enqueueResult = (result, isError) => {
        buffer.push(result);
        saved++;
        if (isError)
            errors++;
        if (result.decision === "include")
            include++;
        else if (result.decision === "exclude")
            exclude++;
        else
            uncertain++;
        if (buffer.length >= flushEvery)
            flushBuffer();
    };
    await mapPool(pending, concurrency, async (abs, index) => {
        try {
            const result = await chain.run(abs);
            options.onResult?.(result, index, pending.length);
            enqueueResult(result, false);
        }
        catch (err) {
            options.onError?.(abs, err, index);
            const fallback = {
                pmid: abs.pmid,
                title: abs.title,
                decision: "uncertain",
                confidence: 0,
                ptmTypes: [],
                organisms: [],
                isQuantitativeMs: false,
                hasSiteLevelDataHint: false,
                quantificationMethods: [],
                dataSourceHint: "unknown",
                reason: `ScreenChain error: ${err instanceof Error ? err.message : String(err)}`,
                sourceFile: abs.sourceFile,
                screenedAt: new Date().toISOString(),
            };
            enqueueResult(fallback, true);
        }
        return null;
    });
    flushBuffer();
    await writeLock;
    exportIncludePmidsCsv();
    exportUncertainPmidsCsv();
    const stats = computeStats();
    return {
        modelId: runtime.modelId,
        attempted: pending.length,
        saved,
        errors,
        include,
        exclude,
        uncertain,
        pendingAfter: stats.pending,
        sourceFileFilter: sourceFile,
        abstractsFromLocal,
        abstractsFetched,
        abstractsMissing,
    };
}
