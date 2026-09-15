import OpenAI from "openai";
import { cfg } from "../config.js";
import { extractReasoning, isEmptyLlmResult } from "./reasoning.js";
import { getOpenCodeSessionId } from "./session-context.js";
const ZEN_PREFIXES = ["gpt-", "gemini-", "claude-", "kimi-", "qwen"];
function baseUrlForModel(model) {
    const m = model.toLowerCase();
    if (ZEN_PREFIXES.some((p) => m.startsWith(p)))
        return cfg.deepseekZenBaseUrl;
    return cfg.deepseekBaseUrl;
}
export class LlmClient {
    clients = new Map();
    clientFor(model) {
        const base = baseUrlForModel(model);
        let c = this.clients.get(base);
        if (!c) {
            c = new OpenAI({
                apiKey: cfg.deepseekApiKey,
                baseURL: base,
                maxRetries: 0,
                timeout: cfg.llmTimeoutMs,
            });
            this.clients.set(base, c);
        }
        return c;
    }
    modelChain() {
        const blocked = new Set(["qwen3.7-max"]);
        const chain = [cfg.deepseekModel, ...cfg.deepseekFallbackModels];
        return [
            ...new Set(chain.filter((m) => {
                if (!m)
                    return false;
                const bare = m.includes("/") ? m.split("/").pop() || m : m;
                return !blocked.has(m.toLowerCase()) && !blocked.has(bare.toLowerCase());
            })),
        ];
    }
    modelsForAttempt(maxModels) {
        const chain = this.modelChain();
        if (!maxModels || maxModels >= chain.length)
            return chain;
        return chain.slice(0, Math.max(1, maxModels));
    }
    attemptTimeoutMs(options, deadline) {
        const perCall = options.timeoutMs ?? cfg.llmTimeoutMs;
        if (!deadline)
            return perCall;
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return null;
        return Math.max(5000, Math.min(perCall, remaining));
    }
    requestOptionsFor(model) {
        const base = baseUrlForModel(model);
        if (base !== cfg.deepseekBaseUrl)
            return {};
        const sessionId = getOpenCodeSessionId();
        if (!sessionId)
            return {};
        return { headers: { "x-opencode-session": sessionId } };
    }
    async chatCompletion(messages, options = {}) {
        const models = this.modelsForAttempt(options.maxModels);
        const deadline = options.totalTimeoutMs ? Date.now() + options.totalTimeoutMs : null;
        let lastErr = null;
        for (const model of models) {
            const timeout = this.attemptTimeoutMs(options, deadline);
            if (timeout == null)
                break;
            try {
                const res = await this.clientFor(model).chat.completions.create({
                    model,
                    messages,
                    tools: options.tools,
                    temperature: options.temperature ?? 0.3,
                    max_tokens: options.maxTokens ?? 4096,
                }, { signal: AbortSignal.timeout(timeout), ...this.requestOptionsFor(model) });
                const choice = res.choices[0];
                const msg = choice?.message;
                const content = msg?.content || "";
                const reasoning = extractReasoning(msg) || extractReasoning(choice);
                const toolCalls = (msg?.tool_calls || []).map((tc) => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: JSON.parse(tc.function.arguments || "{}"),
                }));
                if (isEmptyLlmResult(content, toolCalls))
                    throw new Error("empty response");
                return { content, reasoning, toolCalls };
            }
            catch (e) {
                lastErr = e instanceof Error ? e : new Error(String(e));
            }
        }
        throw lastErr || new Error("LLM failed");
    }
    async *chatCompletionStream(messages, options = {}) {
        const models = this.modelsForAttempt(options.maxModels);
        const deadline = options.totalTimeoutMs ? Date.now() + options.totalTimeoutMs : null;
        let lastErr = null;
        for (const model of models) {
            const timeout = this.attemptTimeoutMs(options, deadline);
            if (timeout == null)
                break;
            try {
                const stream = await this.clientFor(model).chat.completions.create({
                    model,
                    messages,
                    tools: options.tools,
                    temperature: options.temperature ?? 0.3,
                    max_tokens: options.maxTokens ?? 8192,
                    stream: true,
                }, { signal: AbortSignal.timeout(timeout), ...this.requestOptionsFor(model) });
                const toolAcc = new Map();
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;
                    if (!delta)
                        continue;
                    if (delta.content)
                        yield { type: "text", content: delta.content };
                    const reasoning = extractReasoning(delta) || extractReasoning(chunk.choices[0]);
                    if (reasoning)
                        yield { type: "reasoning", content: reasoning };
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            let acc = toolAcc.get(idx);
                            if (!acc) {
                                acc = { id: tc.id || `call_${idx}`, name: tc.function?.name || "", args: "" };
                                toolAcc.set(idx, acc);
                            }
                            if (tc.id)
                                acc.id = tc.id;
                            if (tc.function?.name)
                                acc.name = tc.function.name;
                            if (tc.function?.arguments)
                                acc.args += tc.function.arguments;
                        }
                    }
                }
                for (const acc of toolAcc.values()) {
                    if (acc.name) {
                        yield {
                            type: "tool_call",
                            id: acc.id,
                            name: acc.name,
                            arguments: JSON.parse(acc.args || "{}"),
                        };
                    }
                }
                yield { type: "done" };
                return;
            }
            catch (e) {
                lastErr = e instanceof Error ? e : new Error(String(e));
            }
        }
        throw lastErr || new Error("LLM stream failed");
    }
}
let singleton = null;
export function getLlm() {
    if (!singleton)
        singleton = new LlmClient();
    return singleton;
}
