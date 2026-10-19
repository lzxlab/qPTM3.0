import { assistantText, completeSimpleWithFallback } from "../../runtime.js";
import { preferMsDataSource, sortAccessionsForMeta, } from "../../stage2/accessions.js";
import { META_SYSTEM, buildMetaUserPrompt } from "./prompt.js";
import { MetaParseError, parseMetaOutput } from "./parse.js";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Transient provider/stream failures that often succeed on retry. */
export function isTransientMetaLlmError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new RegExp([
        "stream ended",
        "without finish_reason",
        "finish_reason",
        "llm_call_timeout",
        "timeout",
        "empty text content",
        "ECONNRESET",
        "ETIMEDOUT",
        "EAI_AGAIN",
        "socket",
        "429",
        "503",
        "502",
        "504",
        "overloaded",
        "rate.?limit",
        "temporar",
        "unavailable",
        "fetch failed",
    ].join("|"), "i").test(msg);
}
/**
 * Specialized Stage-3 metadata extraction chain.
 * Deterministic I/O: paper excerpt → LiteratureInfoRow
 */
export class MetaChain {
    runtime;
    options;
    constructor(runtime, options = {}) {
        this.runtime = runtime;
        this.options = options;
    }
    async run(input) {
        const retryParse = this.options.retryOnParseError !== false;
        const maxTransient = Math.max(0, this.options.maxTransientRetries ?? 2);
        const maxAttempts = 1 + maxTransient;
        let lastErr;
        let usedParseRetryHint = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const isRetry = attempt > 0;
            try {
                return await this.runOnce(input, usedParseRetryHint || (isRetry && lastErr instanceof MetaParseError));
            }
            catch (err) {
                lastErr = err;
                const canRetryParse = retryParse && err instanceof MetaParseError && !usedParseRetryHint;
                const canRetryTransient = isTransientMetaLlmError(err);
                if (attempt >= maxAttempts - 1)
                    break;
                if (canRetryParse) {
                    usedParseRetryHint = true;
                    continue;
                }
                if (canRetryTransient) {
                    await sleep(400 * (attempt + 1));
                    continue;
                }
                break;
            }
        }
        throw lastErr;
    }
    async runOnce(input, isRetry) {
        const knownHits = sortAccessionsForMeta((input.knownIdentifiers || []).map((h) => ({
            id: (h.id || "").toUpperCase().trim(),
            source: h.source || "unknown",
            via: "known",
        })).filter((h) => h.id));
        const known = knownHits.map((h) => `${h.id} (${h.source})`).join("; ");
        const fallbackIdentifier = knownHits.map((h) => h.id).join("; ");
        const fallbackMsDataSource = preferMsDataSource("", knownHits, input.excerpt);
        const user = buildMetaUserPrompt({
            pmid: input.pmid,
            title: input.title,
            excerpt: input.excerpt,
            knownIdentifiers: known,
        });
        const retryHint = isRetry
            ? "\n\nYour previous answer was not valid JSON. Reply with ONLY one JSON object matching the schema."
            : "";
        const message = await completeSimpleWithFallback(this.runtime, {
            systemPrompt: META_SYSTEM,
            messages: [
                {
                    role: "user",
                    content: user + retryHint,
                    timestamp: Date.now(),
                },
            ],
        }, {
            temperature: this.options.temperature ?? 0,
        });
        const text = assistantText(message);
        const row = parseMetaOutput(text, {
            pmid: input.pmid,
            title: input.title,
            textSource: input.textSource,
            fallbackIdentifier,
            fallbackMsDataSource,
        });
        // Prefer Stage-2 / KnownIdentifiers — especially native IPX over PXD partner IDs.
        if (knownHits.length > 0) {
            const knownIds = knownHits.map((h) => h.id);
            const knownSet = new Set(knownIds);
            const llmIds = (row.identifier || "")
                .split(/[;,\s]+/)
                .map((x) => x.trim().toUpperCase())
                .filter(Boolean);
            const nativeKnown = knownHits.filter((h) => /^(IPX|JPST|MSV|PDC)/i.test(h.id));
            const llmOnlyPxd = llmIds.length > 0 && llmIds.every((id) => /^PXD/i.test(id));
            // LLM invented/kept only PXD while we already know IPX… → native IDs win.
            if (nativeKnown.length > 0 && (llmOnlyPxd || !row.identifier)) {
                const merged = [...nativeKnown.map((h) => h.id)];
                for (const id of llmIds) {
                    if (!knownSet.has(id) && !merged.includes(id))
                        merged.push(id);
                }
                for (const id of knownIds) {
                    if (!merged.includes(id))
                        merged.push(id);
                }
                row.identifier = merged.join("; ");
            }
            else if (!row.identifier) {
                row.identifier = fallbackIdentifier;
            }
            else {
                const have = new Set(llmIds);
                for (const id of knownIds) {
                    if (!have.has(id)) {
                        row.identifier = `${row.identifier}; ${id}`;
                        have.add(id);
                    }
                }
            }
            row.msDataSource = preferMsDataSource(row.msDataSource, knownHits, input.excerpt);
        }
        else if (!row.msDataSource && fallbackMsDataSource) {
            row.msDataSource = fallbackMsDataSource;
        }
        return row;
    }
}
