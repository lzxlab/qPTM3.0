export type ArtifactKind = "literature_search" | "paper" | "db_result" | "web_search" | "plan" | "clarification";
export interface DbBlockPayload {
    tool?: string;
    source?: string;
    evidence_level?: string;
    total: number;
    shown: number;
    truncated: boolean;
    rows: Record<string, unknown>[];
}
export interface ArtifactPayload {
    intent?: string;
    blocks: DbBlockPayload[];
}
export interface Artifact {
    id: string;
    kind: ArtifactKind;
    query: string;
    summary: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    pmids?: string[];
    rawRef?: string;
    payload?: ArtifactPayload;
    createdAt: string;
}
/** Compact MCP intent blocks so sessions can list last-query hits. */
export declare function compactDbPayload(result: {
    intent?: string;
    blocks?: unknown[];
}): ArtifactPayload | undefined;
export declare class ArtifactStore {
    private artifacts;
    private counter;
    add(kind: ArtifactKind, query: string, summary: string, extra?: Partial<Artifact>): Artifact;
    list(): Artifact[];
    get(id: string): Artifact | undefined;
    catalogForPrompt(max?: number, opts?: {
        skipEmpty?: boolean;
    }): string;
    load(list: Artifact[]): void;
    toJSON(): Artifact[];
    clear(): void;
}
