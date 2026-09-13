import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../sse.js";
import { ArtifactStore } from "../context/artifacts.js";
import {
  applyPersistedSession,
  getOrCreateSession,
  sessionToPersisted,
  type PersistedSession,
} from "../context/session.js";
import { loadConversationState } from "../storage/conversations.js";
import {
  mergeClarification,
  applyClarificationToMemory,
  buildDeepResearchClarification,
  clarificationEvent,
} from "./clarification.js";
import { runQA } from "./qa-react.js";
import { runDeepResearch } from "./deep-research.js";
import { detectLang, classifyQueryMode, shouldSkipInvestigation } from "./gate.js";
import {
  mergeEntities,
  normalizeTargetIdentity,
  parseEntities,
  wantsSameSite,
} from "../context/memory.js";
import { AgentPhase, setPhase } from "./phase.js";
import { routeQuery } from "./router.js";

export type AgentMode = "qa" | "deep_research";

/** Soft cap so the agent can ask multiple times, but not loop forever. */
const MAX_CLARIFY_ROUNDS = 4;

export interface RunAgentOptions {
  message: string;
  sessionId: string;
  conversationId?: string;
  history: Array<{ role: string; content: string }>;
  mode: AgentMode;
  clarificationResponse?: {
    skip?: boolean;
    selections?: Record<string, string>;
    free_text?: string;
  } | null;
}

export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const sessionKey = opts.conversationId || opts.sessionId;
  const session = getOrCreateSession(sessionKey);
  if (session.turnCount === 0 && opts.conversationId) {
    const saved = loadConversationState(opts.conversationId);
    if (saved) applyPersistedSession(session, saved as PersistedSession);
  }
  session.turnCount += 1;
  session.phase = AgentPhase.routing;

  let userMessage = (opts.message || "").trim();
  const parsed = parseEntities(userMessage);
  const reuse = wantsSameSite(userMessage);
  const geneChanged =
    Boolean(parsed.gene && session.memory.gene && parsed.gene.toUpperCase() !== session.memory.gene.toUpperCase());
  const pmidOnly = Boolean(parsed.pmid && !parsed.gene && !parsed.uniprot_ac);
  if (!reuse && (geneChanged || pmidOnly || (parsed.gene && !session.memory.gene && session.memory.uniprot_ac))) {
    session.artifacts = new ArtifactStore();
    session.citations = [];
    session.memory.findings_summary = "";
    session.pendingClarification = null;
    session.deepResearchBrief = null;
    session.clarifyRound = 0;
  }
  mergeEntities(session.memory, parsed, userMessage);
  const lang = detectLang(userMessage);
  const queryMode = classifyQueryMode(userMessage, parsed);
  session.memory.query_mode = queryMode;
  session.lastMode = shouldSkipInvestigation(queryMode) ? "qa" : "deep_research";

  let skippedClarify = false;

  if (opts.clarificationResponse) {
    const base = (session.deepResearchBrief || userMessage).trim();
    if (!opts.clarificationResponse.skip) {
      applyClarificationToMemory(
        session.memory,
        opts.clarificationResponse.selections || {},
        opts.clarificationResponse.free_text || "",
      );
      userMessage = mergeClarification(
        base,
        opts.clarificationResponse.selections || {},
        opts.clarificationResponse.free_text || "",
      );
    } else {
      skippedClarify = true;
      userMessage = base;
    }
    session.deepResearchBrief = userMessage;
    session.clarifyRound += 1;
    mergeEntities(session.memory, parseEntities(userMessage), userMessage);
    normalizeTargetIdentity(session.memory, userMessage);
    session.pendingClarification = null;
  } else {
    session.clarifyRound = 0;
    session.deepResearchBrief = userMessage;
  }

  const decision = routeQuery({
    queryMode,
    clarificationResponse: opts.clarificationResponse,
    memory: session.memory,
    clarifyRound: session.clarifyRound,
    maxClarifyRounds: MAX_CLARIFY_ROUNDS,
    skippedClarify,
  });

  if (decision.handler === "qa_direct") {
    yield* runQA(userMessage, opts.history, session);
    return;
  }

  if (decision.handler === "clarify") {
    yield setPhase(
      session,
      AgentPhase.clarifying,
      lang === "zh"
        ? session.clarifyRound > 0
          ? "根据已有信息，判断是否还需要补充…"
          : "思考需要澄清的问题…"
        : session.clarifyRound > 0
          ? "Checking whether more clarification is needed…"
          : "Thinking about what to clarify…",
    );
    const payload = await buildDeepResearchClarification(userMessage, session.memory, {
      round: session.clarifyRound,
      maxRounds: MAX_CLARIFY_ROUNDS,
    });
    if (payload.needs_clarification && (payload.fields || []).length) {
      session.pendingClarification = { message: userMessage, payload };
      yield clarificationEvent(payload);
      return;
    }
  }

  normalizeTargetIdentity(session.memory, userMessage);
  yield* runDeepResearch(userMessage, opts.history, session);
}

export function snapshotSession(sessionId: string, conversationId?: string): PersistedSession | null {
  const key = conversationId || sessionId;
  const session = getOrCreateSession(key);
  return sessionToPersisted(session);
}

export function newSessionId(): string {
  return randomUUID();
}
