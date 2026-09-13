export declare const cfg: {
    port: number;
    host: string;
    deepseekApiKey: string;
    deepseekBaseUrl: string;
    deepseekZenBaseUrl: string;
    deepseekModel: string;
    deepseekFallbackModels: string[];
    conversationsDataDir: string;
    qptmMcpCommand: string;
    qptmMcpArgs: string[];
    qptmMcpCwd: string;
    biomcpCommand: string;
    biomcpArgs: string[];
    tavilyApiKey: string;
    webSearchTimeoutMs: number;
    /** Per-LLM-attempt timeout (ms). */
    llmTimeoutMs: number;
    /** Total wall-clock budget for Deep Research report synthesis (ms). */
    drSynthesisTimeoutMs: number;
    drSynthesisMaxTokens: number;
    /** How many models to try before failing DR synthesis (limits 10+ min fallback chains). */
    drSynthesisMaxModels: number;
    skillsDir: string;
    qaMaxRounds: number;
    drMaxPlanSteps: number;
    drSupervisorMaxRounds: number;
    corsOrigins: string[];
    backendBaseUrl: string;
};
