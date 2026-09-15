/**
 * Accept both `{ role, content, meta }` and `{ messages: [...] }` plus optional `title`.
 * Collection UI historically posted the batch shape; empty top-level fields must not
 * be stored as blank user bubbles.
 */
export function parseConversationMessagePost(body) {
    const raw = body && typeof body === "object" ? body : {};
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const batch = Array.isArray(raw.messages) ? raw.messages : null;
    const items = batch && batch.length ? batch : [raw];
    const messages = [];
    for (const item of items) {
        if (!item || typeof item !== "object")
            continue;
        const row = item;
        const role = String(row.role || "user");
        const content = String(row.content || "");
        const meta = row.meta && typeof row.meta === "object" ? row.meta : null;
        if (!content.trim() && !meta)
            continue;
        messages.push({ role, content, meta });
    }
    return { title, messages };
}
