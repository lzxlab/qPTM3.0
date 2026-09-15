import OpenAI from "openai";
export type LlmStreamEvent = {
    type: "text";
    content: string;
} | {
    type: "reasoning";
    content: string;
} | {
    type: "tool_call";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
} | {
    type: "done";
};
export declare class LlmClient {
    private clients;
    private clientFor;
    modelChain(): string[];
    private modelsForAttempt;
    private attemptTimeoutMs;
    private requestOptionsFor;
    chatCompletion(messages: OpenAI.Chat.ChatCompletionMessageParam[], options?: {
        tools?: OpenAI.Chat.ChatCompletionTool[];
        temperature?: number;
        maxTokens?: number;
        timeoutMs?: number;
        totalTimeoutMs?: number;
        maxModels?: number;
    }): Promise<{
        content: string;
        reasoning: string;
        toolCalls: Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
        }>;
    }>;
    chatCompletionStream(messages: OpenAI.Chat.ChatCompletionMessageParam[], options?: {
        tools?: OpenAI.Chat.ChatCompletionTool[];
        temperature?: number;
        maxTokens?: number;
        timeoutMs?: number;
        totalTimeoutMs?: number;
        maxModels?: number;
    }): AsyncGenerator<LlmStreamEvent>;
}
export declare function getLlm(): LlmClient;
