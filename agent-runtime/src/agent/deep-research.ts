import { cfg } from "../config.js";
import type { ArtifactStore } from "../context/artifacts.js";
import {
  InvestigationMemory,
  mergeEntities,
  memoryPromptBlock,
  normalizeTargetIdentity,
  parseEntities,
} from "../context/memory.js";
import { SessionState } from "../context/session.js";
import { readQptmResource } from "../mcp/hub.js";
import { loadSkills, skillsForMode } from "../skills/loader.js";
import { getLlm } from "../llm/client.js";
import type { AgentEvent } from "../sse.js";
import { type Citation } from "./citations.js";
import { detectLang } from "./gate.js";
import { generateFollowUps, ptmSteerFollowUps } from "./followups.js";
import { cannotInvestigateSiteLevel } from "./clarification.js";
import {
  resolveSessionTarget,
  resolvedBanner,
} from "./resolve-target.js";
import { sanitizeUserVisibleText } from "./protocol.js";
import { AgentPhase, setPhase } from "./phase.js";
import {
  createDrState,
  runSupervisorLoop,
} from "./dr-research-loop.js";

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
      lang === "zh" ? "说明缺少靶点" : "Need a protein/site first",
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
  const state = createDrState();

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
  );

  yield setPhase(session, AgentPhase.synthesis, lang === "zh" ? "撰写深度调研报告" : "Writing research report");

  const banner = resolvedBanner(memory, lang);
  if (banner) yield { type: "text", content: banner };

  let reportBody = "";
  try {
    for await (const chunk of streamDeepReport(
      userMessage,
      history,
      memory,
      artifacts,
      skills,
      sourcesCatalog,
      citations,
      lang,
    )) {
      reportBody += chunk;
      yield { type: "text", content: chunk };
    }
  } catch (e) {
    const fallback =
      lang === "zh"
        ? "报告生成超时或失败，请缩小问题范围后重试。"
        : "Report generation timed out or failed. Try a narrower question and retry.";
    if (!reportBody.trim()) {
      reportBody = fallback;
      yield { type: "text", content: fallback };
    }
    console.warn("DR synthesis failed:", e);
  }

  const report = banner + sanitizeUserVisibleText(reportBody, lang);

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

function buildDeepReportMessages(
  question: string,
  history: Array<{ role: string; content: string }>,
  memory: InvestigationMemory,
  artifacts: ArtifactStore,
  skills: string,
  catalog: string,
  citations: Citation[],
  lang: "zh" | "en",
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const citeList = citations.map((c) => `${c.id}: ${c.database}`).join(", ");
  const system =
    lang === "zh"
      ? `你是 PTM 深度调研专家。基于已收集证据撰写分节、引用充分的调研报告。
规则：
1. 按用户问题组织章节，不要套用 WHO/WHEN/WHERE/WHY 固定标题。
2. 区分数据库事实 vs 文献深挖 vs 机制推理；标注 evidence level。
3. GPS/PhosLLPS 等 predicted 不得写成实验证实。
4. [empty_result]=库无记录；[call_bug]=调用失败；诚实标注缺口。
5. 文献补洞段落须标明来自 PubMed/PubTator，不可冒充 qPTM 定量。
6. 若证据为空或只有 empty_result、且没有解析到基因/位点：不要写空章节骨架或空检索清单，只说明缺靶点并请用户补充具体蛋白与残基。
引用：${citeList}
已解析靶点：${memoryPromptBlock(memory)}。`
      : `You are a PTM deep-research expert. Write a sectioned, well-cited report from collected evidence.
Rules:
1. Organize by the user's question — no forced WHO/WHEN/WHERE/WHY headings.
2. Separate database facts vs literature depth-search vs hypotheses; label evidence levels.
3. Never present GPS/PhosLLPS predictions as experimental proof.
4. [empty_result]=no DB records; [call_bug]=call failed; state gaps honestly.
5. Literature-filled sections must cite PubMed/PubTator — not qPTM quantitative claims.
6. If evidence is empty or only empty_result and no gene/site was resolved: do not write an empty section skeleton or empty retrieval lists — say the target is missing and ask for a protein and residue.
Citations: ${citeList}
Resolved: ${memoryPromptBlock(memory)}.`;

  const evidence = [
    memory.findings_summary,
    artifacts.catalogForPrompt(12, { skipEmpty: true }),
    artifacts.getLiteratureContext(),
  ].join("\n\n");

  return [
    { role: "system", content: `${system}\n\n${skills}\n${catalog.slice(0, 3500)}` },
    ...history.slice(-6).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    {
      role: "user",
      content: `Research question: ${question}\n\nEvidence collected:\n${evidence.slice(0, 10000)}`,
    },
  ];
}

async function* streamDeepReport(
  question: string,
  history: Array<{ role: string; content: string }>,
  memory: InvestigationMemory,
  artifacts: ArtifactStore,
  skills: string,
  catalog: string,
  citations: Citation[],
  lang: "zh" | "en",
): AsyncGenerator<string> {
  const messages = buildDeepReportMessages(
    question,
    history,
    memory,
    artifacts,
    skills,
    catalog,
    citations,
    lang,
  );
  const llm = getLlm();
  let gotText = false;

  for await (const ev of llm.chatCompletionStream(messages, {
    maxTokens: cfg.drSynthesisMaxTokens,
    temperature: 0.35,
    maxModels: cfg.drSynthesisMaxModels,
    totalTimeoutMs: cfg.drSynthesisTimeoutMs,
  })) {
    if (ev.type !== "text" || !ev.content) continue;
    gotText = true;
    yield ev.content;
  }

  if (!gotText) throw new Error("empty DR report stream");
}
