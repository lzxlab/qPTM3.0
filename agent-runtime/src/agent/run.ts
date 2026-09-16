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
} from "./clarification.js";
import { detectLang, isCollectionRequest } from "./gate.js";
import { generateFollowUps, ptmSteerFollowUps } from "./followups.js";
import {
  mergeEntities,
  normalizeTargetIdentity,
  parseEntities,
  wantsSameSite,
} from "../context/memory.js";
import { AgentPhase, setPhase } from "./phase.js";
import { runReactLoop } from "./react-loop.js";
import { composeAnswer } from "./compose-answer.js";
import { sanitizeUserVisibleText, stripProtocolMarkup } from "./protocol.js";
import type { Citation } from "./citations.js";

export type AgentMode = "qa" | "deep_research";

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

  if (isCollectionRequest(userMessage, parsed, [])) {
    const lang = detectLang(userMessage);
    const reply =
      lang === "zh"
        ? "这是文献采集任务。请在对话里走数据采集流程（上传 PDF/补充表，或带 PMID 的收集请求），我不会在问答循环里执行入库。"
        : "This looks like a literature-collection request. Use the data-collection flow (upload a PDF/supplement, or a PMID collect request). I will not run ingestion inside the Q&A loop.";
    yield setPhase(session, AgentPhase.synthesis, "Collection is a separate pipeline");
    yield { type: "text", content: reply };
    yield { type: "follow_up_questions", questions: ptmSteerFollowUps(lang).slice(0, 3) };
    yield { type: "done" };
    return;
  }

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
      userMessage = base;
    }
    session.deepResearchBrief = userMessage;
    session.pendingClarification = null;
    mergeEntities(session.memory, parseEntities(userMessage), userMessage);
  } else {
    session.deepResearchBrief = userMessage;
  }

  normalizeTargetIdentity(session.memory, userMessage);
  session.lastMode = "qa";

  let draftAnswer = "";
  let toolsUsed: string[] = [];
  for await (const event of runReactLoop(userMessage, opts.history, session)) {
    if (event.type === "_react_finished") {
      draftAnswer = String(event.answer || "");
      toolsUsed = Array.isArray(event.toolsUsed) ? (event.toolsUsed as string[]) : [];
      continue;
    }
    yield event;
  }

  const artifacts = session.artifacts;
  const citations: Citation[] = [...session.citations];
  const lang = detectLang(userMessage);
  if (toolsUsed.length) session.lastMode = "qa";

  yield setPhase(session, AgentPhase.synthesis, "Writing answer");
  yield {
    type: "synthesis_started",
    evidence: {
      db_results: artifacts.findDbResults().length,
      db_rows: artifacts.dbRowCount(),
      literature: artifacts.findLiterature().length,
      web_search: artifacts.findWebSearch().length,
      citations: citations.length,
    },
  };

  let body = "";
  try {
    for await (const chunk of composeAnswer(
      userMessage,
      opts.history,
      session.memory,
      artifacts,
      citations,
    )) {
      if (chunk.kind === "reasoning") {
        const thought = stripProtocolMarkup(chunk.content).text;
        if (thought) yield { type: "report_thought", content: thought };
        continue;
      }
      if (chunk.kind !== "text" || !chunk.content) continue;
      body += chunk.content;
      yield { type: "text", content: chunk.content };
    }
  } catch (e) {
    const fallback =
      lang === "zh"
        ? "生成失败，请重试。"
        : "Generation failed. Please retry.";
    if (!body.trim()) {
      body = sanitizeUserVisibleText(draftAnswer, lang) || fallback;
      yield { type: "text", content: body };
    }
    console.warn("composeAnswer failed:", e);
  }

  const answer = sanitizeUserVisibleText(body, lang);
  yield { type: "sources", citations };
  session.citations = citations;
  const followUps = await generateFollowUps(
    userMessage,
    answer,
    session.memory,
    artifacts,
    "qa",
    toolsUsed,
  );
  yield { type: "follow_up_questions", questions: followUps.length ? followUps : ptmSteerFollowUps(lang) };
  yield { type: "done" };
}

export function snapshotSession(sessionId: string, conversationId?: string): PersistedSession | null {
  const key = conversationId || sessionId;
  const session = getOrCreateSession(key);
  return sessionToPersisted(session);
}

export function newSessionId(): string {
  return randomUUID();
}
