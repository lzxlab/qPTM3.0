export type ArtifactKind = "literature_search" | "paper" | "db_result" | "web_search" | "plan" | "clarification";
export interface Artifact {
    id: string;
    kind: ArtifactKind;
    query: string;
    summary: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    pmids?: string[];
    rawRef?: string;
    createdAt: string;
}
export declare class ArtifactStore {
    private artifacts;
    private counter;
    add(kind: ArtifactKind, query: string, summary: string, extra?: Partial<Artifact>): Artifact;
    list(): Artifact[];
    get(id: string): Artifact | undefined;
    findLiterature(): Artifact[];
    findDbResults(): Artifact[];
    catalogForPrompt(max?: number, opts?: {
        skipEmpty?: boolean;
    }): string;
    load(list: Artifact[]): void;
    toJSON(): Artifact[];
    clear(): void;
    shouldSkipLiteratureSearch(message: string): boolean;
    getLiteratureContext(): string;
}
