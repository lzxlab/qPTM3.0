export type IncomingConversationMessage = {
    role: string;
    content: string;
    meta?: Record<string, unknown> | null;
};
/**
 * Accept both `{ role, content, meta }` and `{ messages: [...] }` plus optional `title`.
 * Collection UI historically posted the batch shape; empty top-level fields must not
 * be stored as blank user bubbles.
 */
export declare function parseConversationMessagePost(body: unknown): {
    title: string;
    messages: IncomingConversationMessage[];
};
