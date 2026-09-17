export function sseFormat(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
export function agentEventToSse(event) {
    const t = event.type;
    if (t.startsWith("_"))
        return null;
    switch (t) {
        case "text":
            return sseFormat("text", { content: event.content || "" });
        case "tool_call":
            return sseFormat("tool_call", {
                tool_name: event.tool_name,
                arguments: event.arguments || {},
                kind: event.kind || "database",
            });
        case "tool_result":
            return sseFormat("tool_result", {
                ...event.payload,
                kind: event.kind || "database",
            });
        case "phase_update": {
            const data = {
                phase: event.phase || "",
                label: event.label || "",
            };
            if (typeof event.detail === "string" && event.detail.trim()) {
                data.detail = event.detail;
            }
            return sseFormat("phase_update", data);
        }
        case "sources":
            return sseFormat("sources", { citations: event.citations || [] });
        case "follow_up_questions":
            return sseFormat("follow_up_questions", { questions: event.questions || [] });
        case "done":
            return sseFormat("done", {});
        case "error":
            return sseFormat("error", { message: event.message || "Unknown error" });
        case "literature_search":
            return sseFormat("literature_search", {
                round: event.round,
                query: event.query || "",
                papers_found: event.papers_found || 0,
                elapsed_s: event.elapsed_s || 0,
            });
        case "report_thought":
            return sseFormat("report_thought", { content: event.content || "" });
        default:
            return null;
    }
}
