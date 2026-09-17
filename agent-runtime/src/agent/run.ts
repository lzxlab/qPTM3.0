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
import { isCollectionRequest } from "./collection.js";
import { generateFollowUps, ptmSteerFollowUps } from "./followups.js";
import {
  mergeEntities,
  normalizeTargetIdentity,
  parseEntities,
  wantsSameSite,
} from "../context/memory.js";
import { AgentPhase, setPhase } from "./phase.js";
import { runReactLoop } from "./react-loop.js";
import { sanitizeUserVisibleText } from "./protocol.js";
import type { Citation } from "./citations.js";

export type AgentMode = "qa" | "deep_research";

export interface RunAgentOptions {
  message: string;
  sessionId: string;
  conversationId?: string;
  history: Array<{ role: string; content: string }>;
  mode: AgentMode;
}

const COLLECTION_DIVERT =
  "This looks like a literature-collection request. Use the data-collection flow (upload a PDF/supplement, or a PMID collect request). I will not run ingestion inside the Q&A loop.";

export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const sessionKey = opts.conversationId || opts.sessionId;
  const session = getOrCreateSession(sessionKey);
  if (session.turnCount === 0 && opts.conversationId) {
    const saved = loadConversationState(opts.conversationId);
    if (saved) applyPersistedSession(session, saved as PersistedSession);
  }
  session.turnCount += 1;
  session.phase = AgentPhase.routing;

  const userMessage = (opts.message || "").trim();
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
    yield setPhase(session, AgentPhase.synthesis, "Collection is a separate pipeline");
    yield { type: "text", content: COLLECTION_DIVERT };
    yield { type: "follow_up_questions", questions: ptmSteerFollowUps().slice(0, 3) };
    yield { type: "done" };
    return;
  }

  session.deepResearchBrief = userMessage;
  normalizeTargetIdentity(session.memory, userMessage);
  session.lastMode = "qa";

  let body = "";
  let toolsUsed: string[] = [];
  for await (const event of runReactLoop(userMessage, opts.history, session)) {
    if (event.type === "_react_finished") {
      toolsUsed = Array.isArray(event.toolsUsed) ? (event.toolsUsed as string[]) : [];
      continue;
    }
    if (event.type === "text") body += String(event.content || "");
    yield event;
  }

  const citations: Citation[] = [...session.citations];
  if (toolsUsed.length) session.lastMode = "qa";

  const answer = sanitizeUserVisibleText(body);
  yield { type: "sources", citations };
  session.citations = citations;
  const followUps = await generateFollowUps(
    userMessage,
    answer,
    session.memory,
    session.artifacts,
    "qa",
    toolsUsed,
  );
  yield { type: "follow_up_questions", questions: followUps.length ? followUps : ptmSteerFollowUps() };
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
