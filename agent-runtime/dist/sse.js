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
        case "clarification_request": {
            const { type: _, ...rest } = event;
            return sseFormat("clarification_request", rest);
        }
        case "plan_created":
            return sseFormat("plan_created", event.plan || {});
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
        case "route_decision":
            return sseFormat("route_decision", {
                handler: event.handler || "",
                query_mode: event.query_mode || "",
                specific_enough: Boolean(event.specific_enough),
                may_clarify: Boolean(event.may_clarify),
                entities: event.entities || {},
            });
        case "supervisor_decision":
            return sseFormat("supervisor_decision", {
                round: event.round,
                actions: event.actions || [],
                rationale: event.rationale || "",
                gap_score: event.gap_score,
                outcomes_summary: event.outcomes_summary || "",
                finish_accepted: event.finish_accepted,
            });
        case "step_started":
            return sseFormat("step_started", {
                step: event.step,
                title: event.title || "",
                status: "running",
            });
        case "step_completed":
            return sseFormat("step_completed", {
                step: event.step,
                title: event.title || "",
                status: event.status || "done",
            });
        case "synthesis_started":
            return sseFormat("synthesis_started", {
                evidence: event.evidence || {},
            });
        case "report_thought":
            return sseFormat("report_thought", { content: event.content || "" });
        default:
            return null;
    }
}
