import type { AgentEvent } from "../sse.js";

export interface WorkflowPhaseItem {
  id: string;
  label: string;
  status: string;
  ts: number;
  detail?: string;
}

export interface WorkflowPlanStep {
  step: number;
  title: string;
  description: string;
  rationale: string;
  database: string;
  tools: string[];
  status: string;
}

export interface WorkflowToolRow {
  tool_name: string;
  kind: string;
  status: string;
  summary: string;
  arguments: Record<string, unknown>;
  error_kind?: string;
  ts: number;
}

export interface WorkflowStateSnapshot {
  goal: string;
  currentPhase: string;
  status: string;
  phases: WorkflowPhaseItem[];
  plan: { summary: string; steps: WorkflowPlanStep[] };
  tools: WorkflowToolRow[];
  literature: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  decision: Record<string, unknown> | null;
  supervisor: Array<Record<string, unknown>>;
  synthesis: {
    evidence: Record<string, unknown> | null;
    thought: string;
  };
}

const MAX_EVENTS = 120;
const MAX_THOUGHT = 16000;
const MAX_DETAIL = 8000;

export function emptyWorkflowState(): WorkflowStateSnapshot {
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
    synthesis: { evidence: null, thought: "" },
  };
}

function clip(text: unknown, max = MAX_DETAIL): string {
  const s = typeof text === "string" ? text : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function logEvent(state: WorkflowStateSnapshot, kind: string, message: string, extra: Record<string, unknown> = {}): void {
  state.events.push({ ts: Date.now(), kind, message: clip(message, 1000), ...extra });
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
}

function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toolStatusFromPayload(payload: Record<string, unknown>): string {
  const kind = String(payload.error_kind || "");
  if (kind === "empty_result") return "empty";
  if (kind === "missing_params") return "missing";
  if (payload.success === false) return "error";
  return "done";
}

export function applyAgentEvent(state: WorkflowStateSnapshot, event: AgentEvent): void {
  const t = String(event.type || "");
  if (t.startsWith("_") || t === "text" || t === "sources" || t === "follow_up_questions") return;

  if (t === "done") {
    state.status = state.status === "error" ? "error" : "done";
    for (const p of state.phases) if (p.status === "running") p.status = "done";
    for (const tool of state.tools) if (tool.status === "running") tool.status = "done";
    for (const s of state.plan.steps) if (s.status === "pending" || s.status === "running") s.status = "done";
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
      if (prevItem && prevItem.status === "running") prevItem.status = "done";
    }
    state.currentPhase = phase;
    state.status = "running";
    let item = state.phases.find((p) => p.id === phase);
    if (!item) {
      item = { id: phase, label, status: "running", ts: Date.now() };
      state.phases.push(item);
    } else {
      item.status = "running";
      item.label = label || item.label;
      item.ts = Date.now();
    }
    const detail = clip(event.detail);
    if (detail) {
      item.detail = item.detail ? `${item.detail}\n${detail}` : detail;
      logEvent(state, "phase", detail, { phase });
    } else {
      logEvent(state, "phase", label, { phase });
    }
    return;
  }

  if (t === "route_decision") {
    state.decision = {
      handler: event.handler,
      query_mode: event.query_mode,
      specific_enough: event.specific_enough,
      may_clarify: event.may_clarify,
      entities: event.entities || {},
    };
    logEvent(state, "decision", `Route: ${String(event.handler || "")}`);
    return;
  }

  if (t === "supervisor_decision") {
    state.supervisor.push({
      round: event.round,
      actions: event.actions || [],
      rationale: clip(event.rationale),
      gap_score: event.gap_score,
      outcomes_summary: clip(event.outcomes_summary, 1200),
      finish_accepted: event.finish_accepted,
      ts: Date.now(),
    });
    const names = Array.isArray(event.actions)
      ? (event.actions as Array<{ name?: string }>).map((a) => a.name).filter(Boolean).join(", ")
      : "";
    logEvent(state, "supervisor", names || "Supervisor decision", { round: event.round });
    return;
  }

  if (t === "plan_created") {
    const plan = (event.plan || event) as Record<string, unknown>;
    const summary = String(plan.intent_summary || plan.summary || "");
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    state.goal = summary || state.goal;
    state.status = "running";
    state.plan = {
      summary,
      steps: steps.map((s, i) => {
        const row = (s || {}) as Record<string, unknown>;
        return {
          step: Number(row.step) || i + 1,
          title: String(row.title || row.description || `Step ${i + 1}`),
          description: String(row.description || row.rationale || ""),
          rationale: String(row.rationale || ""),
          database: String(row.database || row.entity || ""),
          tools: Array.isArray(row.tools) ? row.tools.map((x) => String(x)) : [],
          status: String(row.status || "pending"),
        };
      }),
    };
    logEvent(state, "plan", summary || "Research plan created");
    return;
  }

  if (t === "step_started" || t === "step_completed") {
    const stepNo = Number(event.step);
    const row = state.plan.steps.find((s) => s.step === stepNo);
    const status = t === "step_started" ? "running" : String(event.status || "done");
    if (row) {
      row.status = status;
      if (event.title) row.title = String(event.title);
    }
    logEvent(state, "plan", `${t === "step_started" ? "Start" : "Done"} step ${Number.isFinite(stepNo) ? stepNo : ""}`.trim());
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
    const payload = (event.payload || event) as Record<string, unknown>;
    const name = String(payload.tool_name || "");
    let target: WorkflowToolRow | undefined;
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
    if (payload.summary) logEvent(state, "tool_result", `${name}: ${payload.summary}`);
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

  if (t === "synthesis_started") {
    state.synthesis.evidence = argsRecord(event.evidence || event);
    logEvent(state, "synthesis", "Writing from collected evidence");
    return;
  }

  if (t === "report_thought") {
    const chunk = String(event.content || "");
    if (!chunk) return;
    const next = `${state.synthesis.thought}${chunk}`;
    state.synthesis.thought = next.length > MAX_THOUGHT ? next.slice(-MAX_THOUGHT) : next;
  }
}

export function workflowHasData(state: WorkflowStateSnapshot): boolean {
  return Boolean(
    state.goal ||
      state.currentPhase ||
      state.phases.length ||
      state.plan.summary ||
      state.plan.steps.length ||
      state.tools.length ||
      state.literature.length ||
      state.events.length ||
      state.decision ||
      state.supervisor.length ||
      state.synthesis.thought ||
      state.synthesis.evidence,
  );
}

/** Invariant helper: only `text` events belong in the saved/shown answer. */
export function appendAnswerText(fullAnswer: string, event: AgentEvent): string {
  if (event.type !== "text") return fullAnswer;
  return fullAnswer + String(event.content || "");
}
