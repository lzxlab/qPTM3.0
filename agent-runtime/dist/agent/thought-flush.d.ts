/** Coalesce reasoning tokens so Studio is not redrawn on every model token. */
export declare class ThoughtFlusher {
    private readonly minChars;
    private readonly minMs;
    private buf;
    private last;
    constructor(minChars?: number, minMs?: number);
    push(chunk: string): string | null;
    flush(): string | null;
    private take;
}
