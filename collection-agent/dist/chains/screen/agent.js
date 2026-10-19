import { assistantText, completeSimpleWithFallback } from "../../runtime.js";
import { SCREEN_SYSTEM, buildScreenUserPrompt } from "./prompt.js";
import { parseScreenOutput, ScreenParseError } from "./parse.js";
/**
 * Specialized Stage-1 classification chain.
 * Deterministic I/O: AbstractRecord → ScreenResult
 * (Pi Coding Agent is NOT used here — only ModelRuntime.completeSimple)
 */
export class ScreenChain {
    runtime;
    options;
    constructor(runtime, options = {}) {
        this.runtime = runtime;
        this.options = options;
    }
    async run(abstract) {
        const retry = this.options.retryOnParseError !== false;
        try {
            return await this.runOnce(abstract, false);
        }
        catch (err) {
            if (retry && err instanceof ScreenParseError) {
                return await this.runOnce(abstract, true);
            }
            throw err;
        }
    }
    async runOnce(abstract, isRetry) {
        const user = buildScreenUserPrompt(abstract.title, abstract.abstract);
        const retryHint = isRetry
            ? "\n\nYour previous answer was not valid JSON. Reply with ONLY one JSON object matching the schema."
            : "";
        const message = await completeSimpleWithFallback(this.runtime, {
            systemPrompt: SCREEN_SYSTEM,
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
        return parseScreenOutput(text, {
            pmid: abstract.pmid,
            title: abstract.title,
            sourceFile: abstract.sourceFile,
        });
    }
}
