import { assistantText, completeSimpleWithFallback } from "../../runtime.js";
import { parseQratioMapOutput, QratioMapParseError } from "./parse.js";
import { buildQratioMapUserPrompt, QRATIO_MAP_SYSTEM } from "./prompt.js";
export class QratioMapChain {
    runtime;
    options;
    constructor(runtime, options = {}) {
        this.runtime = runtime;
        this.options = options;
    }
    async run(input) {
        const retry = this.options.retryOnParseError !== false;
        try {
            return await this.runOnce(input, false);
        }
        catch (err) {
            if (retry && err instanceof QratioMapParseError) {
                return await this.runOnce(input, true);
            }
            throw err;
        }
    }
    async runOnce(input, isRetry) {
        const user = buildQratioMapUserPrompt({
            pmid: input.pmid,
            title: input.title,
            ptms: input.ptms,
            sample: input.sample,
            condition: input.condition,
            detailCondition: input.detailCondition,
            entryPath: input.entryPath,
            sheetName: input.sheet.name,
            headers: input.sheet.headers,
            preview: input.sheet.preview,
            userGuidance: input.userGuidance,
        });
        const retryHint = isRetry
            ? "\n\nYour previous answer was not valid JSON. Reply with ONLY one JSON object matching the schema."
            : "";
        const llmTimeoutMs = Number(process.env.STAGE5_LLM_TIMEOUT_MS ?? 120_000);
        const llmPromise = completeSimpleWithFallback(this.runtime, {
            systemPrompt: QRATIO_MAP_SYSTEM,
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
        const message = await Promise.race([
            llmPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`qratio_llm_timeout_${llmTimeoutMs}ms`)), llmTimeoutMs)),
        ]);
        const text = assistantText(message);
        return parseQratioMapOutput(text, {
            entryPath: input.entryPath,
            sheetName: input.sheet.name,
            headerRowIndex: input.sheet.headerRowIndex,
        });
    }
}
