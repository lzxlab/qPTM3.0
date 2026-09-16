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
    /** Unified ReAct tool rounds (single scheduler). */
    reactMaxRounds: number;
    drMaxPlanSteps: number;
    drSupervisorMaxRounds: number;
    corsOrigins: string[];
    backendBaseUrl: string;
    litSearchLimit: number;
    litAbstractLimit: number;
    litFulltextLimit: number;
    litAbstractMaxChars: number;
    litFulltextMaxChars: number;
    /** Shallow BFS literature (titles/PMIDs only). */
    litBreadthLimit: number;
    /** DFS literature search rounds (1–2). */
    litDepthRounds: number;
};
