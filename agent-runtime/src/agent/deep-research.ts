import {
  mergeEntities,
  normalizeTargetIdentity,
  parseEntities,
} from "../context/memory.js";
import { SessionState } from "../context/session.js";
import { readQptmResource } from "../mcp/hub.js";
import { loadSkills, skillsForMode } from "../skills/loader.js";
import type { AgentEvent } from "../sse.js";
import { type Citation } from "./citations.js";
import { detectLang } from "./gate.js";
import { generateFollowUps, ptmSteerFollowUps } from "./followups.js";
import { cannotInvestigateSiteLevel } from "./clarification.js";
import {
  resolveSessionTarget,
} from "./resolve-target.js";
import { sanitizeUserVisibleText, stripProtocolMarkup } from "./protocol.js";
import { AgentPhase, setPhase } from "./phase.js";
import {
  seedDrStateFromArtifacts,
  runSupervisorLoop,
} from "./dr-research-loop.js";
import { composeAnswer, type ComposeChunk } from "./compose-answer.js";

export async function* runDeepResearch(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  session: SessionState,
): AsyncGenerator<AgentEvent> {
  const memory = session.memory;
  const artifacts = session.artifacts;
  const lang = detectLang(userMessage);
  mergeEntities(memory, parseEntities(userMessage), userMessage);
  normalizeTargetIdentity(memory, userMessage);

  if (cannotInvestigateSiteLevel(memory, userMessage)) {
    yield setPhase(
      session,
      AgentPhase.synthesis,
      "Need a protein/site first",
    );
    const reply =
      lang === "zh"
        ? "没有指定蛋白/位点时，无法查询「哪个激酶修饰了」这类位点级证据。请给出基因+残基（如 AKT1 S473），或选下面的例子。"
        : "Without a protein and residue, I cannot look up site-level evidence such as which kinase modifies a site. Please give a gene + residue (e.g. AKT1 S473), or pick an example below.";
    yield { type: "text", content: reply };
    yield { type: "follow_up_questions", questions: ptmSteerFollowUps(lang).slice(0, 3) };
    yield { type: "done" };
    return;
  }

  if (memory.gene || memory.uniprot_ac) {
    yield {
      type: "tool_call",
      tool_name: "resolve_ptm_target",
      arguments: { gene: memory.gene, position: memory.position, query: userMessage },
      kind: "database",
    };
    const resolved = await resolveSessionTarget(memory, userMessage);
    yield {
      type: "tool_result",
      payload: {
        tool_name: "resolve_ptm_target",
        success: resolved.success,
        summary: resolved.summary,
        error_kind: resolved.error_kind,
        data_count: 1,
      },
      kind: "database",
    };
  }

  const skills = loadSkills(skillsForMode("deep_research", userMessage));
  const sourcesCatalog = await readQptmResource("qptm://sources");
  const citations: Citation[] = [...session.citations];
  const state = seedDrStateFromArtifacts(artifacts);

  yield* runSupervisorLoop(
    userMessage,
    memory,
    session,
    skills,
    sourcesCatalog,
    lang,
    artifacts,
    citations,
    state,
    history,
  );

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

  let reportBody = "";
  try {
    for await (const chunk of composeAnswer(
      userMessage,
      history,
      memory,
      artifacts,
      citations,
    )) {
      if (chunk.kind === "reasoning") {
        const thought = stripProtocolMarkup(chunk.content).text;
        if (thought) yield { type: "report_thought", content: thought };
        continue;
      }
      if (chunk.kind !== "text" || !chunk.content) continue;
      reportBody += chunk.content;
      yield { type: "text", content: chunk.content };
    }
  } catch (e) {
    const fallback =
      lang === "zh"
        ? "生成失败，请缩小问题范围后重试。"
        : "Generation failed. Try a narrower question and retry.";
    if (!reportBody.trim()) {
      reportBody = fallback;
      yield { type: "text", content: fallback };
    }
    console.warn("DR synthesis failed:", e);
  }

  const report = sanitizeUserVisibleText(reportBody, lang);

  yield { type: "sources", citations };
  session.citations = citations;

  const followUps = await generateFollowUps(
    userMessage,
    report,
    memory,
    artifacts,
    "deep_research",
    state.toolsUsed,
  );
  yield { type: "follow_up_questions", questions: followUps };
  yield { type: "done" };
}

/** @deprecated Chat uses composeAnswer. Kept as a thin wrapper for leftover callers. */
export type ReportStreamChunk = ComposeChunk;

export async function* streamDeepReport(
  question: string,
  history: Array<{ role: string; content: string }>,
  memory: Parameters<typeof composeAnswer>[2],
  artifacts: Parameters<typeof composeAnswer>[3],
  _skills: string,
  _catalog: string,
  citations: Citation[],
  _lang: "zh" | "en",
): AsyncGenerator<ReportStreamChunk> {
  yield* composeAnswer(question, history, memory, artifacts, citations);
}
