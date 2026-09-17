const MAX_EVENTS = 120;
const MAX_THOUGHT = 256 * 1024;
const MAX_DETAIL = 8000;
export function emptyWorkflowState() {
    return {
        goal: "",
        currentPhase: "",
        status: "pending",
        phases: [],
        plan: { summary: "", steps: [] },
        tools: [],
        literature: [],
        events: [],
        decision: null,
        supervisor: [],
        synthesis: { thought: "" },
    };
}
function clip(text, max = MAX_DETAIL) {
    const s = typeof text === "string" ? text : "";
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
function logEvent(state, kind, message, extra = {}) {
    state.events.push({ ts: Date.now(), kind, message: clip(message, 1000), ...extra });
    if (state.events.length > MAX_EVENTS)
        state.events = state.events.slice(-MAX_EVENTS);
}
function argsRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function toolStatusFromPayload(payload) {
    const kind = String(payload.error_kind || "");
    if (kind === "empty_result")
        return "empty";
    if (kind === "missing_params")
        return "missing";
    if (payload.success === false)
        return "error";
    return "done";
}
export function applyAgentEvent(state, event) {
    const t = String(event.type || "");
    if (t.startsWith("_") || t === "text" || t === "sources" || t === "follow_up_questions")
        return;
    if (t === "done") {
        state.status = state.status === "error" ? "error" : "done";
        for (const p of state.phases)
            if (p.status === "running")
                p.status = "done";
        for (const tool of state.tools)
            if (tool.status === "running")
                tool.status = "done";
        for (const s of state.plan.steps)
            if (s.status === "pending" || s.status === "running")
                s.status = "done";
        return;
    }
    if (t === "error") {
        state.status = "error";
        logEvent(state, "error", String(event.message || "error"));
        return;
    }
    if (t === "phase_update") {
        const phase = String(event.phase || "");
        const label = String(event.label || phase);
        const prev = state.currentPhase;
        if (prev && prev !== phase) {
            const prevItem = state.phases.find((p) => p.id === prev);
            if (prevItem && prevItem.status === "running")
                prevItem.status = "done";
        }
        state.currentPhase = phase;
        state.status = "running";
        let item = state.phases.find((p) => p.id === phase);
        if (!item) {
            item = { id: phase, label, status: "running", ts: Date.now() };
            state.phases.push(item);
        }
        else {
            item.status = "running";
            item.label = label || item.label;
            item.ts = Date.now();
        }
        const detail = clip(event.detail);
        if (detail) {
            item.detail = item.detail ? `${item.detail}\n${detail}` : detail;
            logEvent(state, "phase", detail, { phase });
        }
        else {
            logEvent(state, "phase", label, { phase });
        }
        return;
    }
    if (t === "tool_call") {
        state.tools.push({
            tool_name: String(event.tool_name || "tool"),
            kind: String(event.kind || "database"),
            status: "running",
            summary: "",
            arguments: argsRecord(event.arguments),
            ts: Date.now(),
        });
        logEvent(state, "tool", String(event.tool_name || "tool"), { kind: event.kind });
        return;
    }
    if (t === "tool_result") {
        const payload = (event.payload || event);
        const name = String(payload.tool_name || "");
        let target;
        for (let i = state.tools.length - 1; i >= 0; i -= 1) {
            if (state.tools[i].tool_name === name || state.tools[i].status === "running") {
                target = state.tools[i];
                break;
            }
        }
        if (target) {
            target.status = toolStatusFromPayload(payload);
            target.summary = String(payload.summary || target.summary || "");
            target.error_kind = String(payload.error_kind || "");
        }
        if (payload.summary)
            logEvent(state, "tool_result", `${name}: ${payload.summary}`);
        return;
    }
    if (t === "literature_search") {
        state.literature.push({
            round: event.round,
            query: event.query,
            papers_found: event.papers_found,
            elapsed_s: event.elapsed_s,
            ts: Date.now(),
        });
        logEvent(state, "literature", `Literature #${event.round}: ${event.query}`);
        return;
    }
    if (t === "report_thought") {
        const chunk = String(event.content || "");
        if (!chunk)
            return;
        const next = `${state.synthesis.thought}${chunk}`;
        state.synthesis.thought = next.length > MAX_THOUGHT ? next.slice(0, MAX_THOUGHT) : next;
    }
}
export function workflowHasData(state) {
    return Boolean(state.goal ||
        state.currentPhase ||
        state.phases.length ||
        state.plan.summary ||
        state.plan.steps.length ||
        state.tools.length ||
        state.literature.length ||
        state.events.length ||
        state.decision ||
        state.supervisor.length ||
        state.synthesis.thought);
}
/** Invariant helper: only `text` events belong in the saved/shown answer. */
export function appendAnswerText(fullAnswer, event) {
    if (event.type !== "text")
        return fullAnswer;
    return fullAnswer + String(event.content || "");
}
