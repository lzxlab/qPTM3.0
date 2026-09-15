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
export function parseConversationMessagePost(body: unknown): {
  title: string;
  messages: IncomingConversationMessage[];
} {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const batch = Array.isArray(raw.messages) ? raw.messages : null;
  const items = batch && batch.length ? batch : [raw];
  const messages: IncomingConversationMessage[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const role = String(row.role || "user");
    const content = String(row.content || "");
    const meta =
      row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : null;
    if (!content.trim() && !meta) continue;
    messages.push({ role, content, meta });
  }
  return { title, messages };
}
