import OpenAI from "openai";
import { cfg } from "../config.js";
import type { ArtifactStore } from "../context/artifacts.js";
import type { InvestigationMemory } from "../context/memory.js";
import { memoryPromptBlock } from "../context/memory.js";
import type { SessionState } from "../context/session.js";
import {
  callQptmTool,
  biomcpGetArticle,
  listMcpTools,
  searchLiteratureArticles,
  webSearch,
  type QptmToolResult,
} from "../mcp/hub.js";
import { getLlm } from "../llm/client.js";
import type { AgentEvent } from "../sse.js";
import { mergeCitation, type Citation } from "./citations.js";
import { AgentPhase, setPhase } from "./phase.js";
import { retrieveIntentToolsDeep } from "./retriever.js";
import { applyResolvedIdentity } from "./resolve-target.js";
import { addFinding } from "../context/memory.js";
import {
  gapScore,
  isCallBug,
  isEmptyToolResult,
  mayRecallIntent,
  outcomesSummary,
  toStepOutcome,
  type StepOutcome,
} from "./tool-result.js";
export interface PlanStep {
  step: number;
  title: string;
  entity: string;
  tools: string[];
  rationale: string;
}

export interface DrResearchState {
  outcomes: StepOutcome[];
  succeededTools: Set<string>;
  emptyTools: Set<string>;
  callBugTools: Set<string>;
  predictedOnlyTools: Set<string>;
  depthSearched: boolean;
  toolsUsed: string[];
}

export function createDrState(): DrResearchState {
  return {
    outcomes: [],
    succeededTools: new Set(),
    emptyTools: new Set(),
    callBugTools: new Set(),
    predictedOnlyTools: new Set(),
    depthSearched: false,
    toolsUsed: [],
  };
}

function recordOutcome(state: DrResearchState, outcome: StepOutcome): void {
  state.outcomes.push(outcome);
  if (outcome.empty) state.emptyTools.add(outcome.tool);
  else if (outcome.callBug) state.callBugTools.add(outcome.tool);
  else if (outcome.predictedOnly) state.predictedOnlyTools.add(outcome.tool);
  else if (outcome.success) state.succeededTools.add(outcome.tool);
}

export async function executeIntent(
  tool: string,
  memory: InvestigationMemory,
  question: string,
  retryOnBug = true,
): Promise<{ tool: string; result: QptmToolResult; outcome: StepOutcome }> {
  const args: Record<string, unknown> = {
    query: question,
    gene: memory.gene || "",
    position: memory.position || 0,
    uniprot_ac: memory.uniprot_ac || "",
    ptm_type: memory.ptm_type || "phosphorylation",
    limit: 15,
  };
  let result = await callQptmTool(tool, args);
  if (retryOnBug && isCallBug(result)) {
    result = await callQptmTool(tool, args);
  }
  return { tool, result, outcome: toStepOutcome(tool, result) };
}

function intentArgs(memory: InvestigationMemory, question: string): Record<string, unknown> {
  return {
    query: question,
    gene: memory.gene || "",
    position: memory.position || 0,
    uniprot_ac: memory.uniprot_ac || "",
    ptm_type: memory.ptm_type || "phosphorylation",
    limit: 15,
  };
}

export async function buildPlan(
  question: string,
  memory: InvestigationMemory,
  skills: string,
  catalog: string,
  lang: "zh" | "en",
  state: DrResearchState,
): Promise<{ summary: string; steps: PlanStep[] }> {
  const available = retrieveIntentToolsDeep(question, memory).filter((t) =>
    mayRecallIntent(t, state.emptyTools, state.succeededTools),
  );
  const excludeNote =
    state.outcomes.length
      ? `\nAlready tried: empty=[${[...state.emptyTools].join(",")}] ok=[${[...state.succeededTools].join(",")}]`
      : "";
  const prompt =
    lang === "zh"
      ? `为 PTM 深度调研生成 JSON 计划。按用户问题与研究维度地图选 intent，不要每次打全库；禁止 WHO/WHEN/WHERE/WHY 标题。
问题：${question}
上下文：${memoryPromptBlock(memory)}
可用工具：${available.join(", ")}${excludeNote}

输出: {"summary":"...","steps":[{"step":1,"title":"生物学主题","entity":"kinase|condition|function|disease|localization|drug|site","tools":["intent_name"],"rationale":"为何必要"}]}
最多 6 步。`
      : `Create a JSON plan for PTM deep research. Use the dimension map — schedule only intents matching the user's question; no WHO/WHEN/WHERE/WHY labels.
Question: ${question}
Context: ${memoryPromptBlock(memory)}
Tools: ${available.join(", ")}${excludeNote}

Output: {"summary":"...","steps":[{"step":1,"title":"theme","entity":"...","tools":["intent_name"],"rationale":"why"}]}
Max 6 steps.`;

  try {
    const llm = getLlm();
    const { content } = await llm.chatCompletion(
      [
        { role: "system", content: `${skills}\n${catalog.slice(0, 3000)}` },
        { role: "user", content: prompt },
      ],
      { maxTokens: 1200, temperature: 0.2 },
    );
    const parsed = JSON.parse(content.replace(/```json?\s*|\s*```/g, "").trim()) as {
      summary?: string;
      steps?: PlanStep[];
    };
    if (parsed.steps?.length) {
      const steps = parsed.steps.slice(0, cfg.drMaxPlanSteps).map((s, i) => ({
        ...s,
        step: i + 1,
        tools: (s.tools || []).filter((t) => mayRecallIntent(t, state.emptyTools, state.succeededTools)),
      }));
      return { summary: parsed.summary || question, steps: steps.filter((s) => s.tools.length) };
    }
  } catch {
    /* fallback */
  }

  const q = question.toLowerCase();
  const steps: PlanStep[] = [];
  const push = (title: string, entity: string, rationale: string, slice: string[]) => {
    if (!slice.length) return;
    steps.push({ step: steps.length + 1, title, entity, tools: slice, rationale });
  };
  push(
    lang === "zh" ? "位点与蛋白背景" : "Site context",
    "site",
    lang === "zh" ? "确认靶点" : "Target context",
    available.filter((t) => /search_ptm_sites|get_localization/.test(t)).slice(0, 2),
  );
  if (/kinase|激酶|调控|enzyme|e3/i.test(q)) {
    push(
      lang === "zh" ? "上游调控" : "Upstream regulation",
      "kinase",
      lang === "zh" ? "激酶/酶证据" : "Kinase evidence",
      available.filter((t) => /get_upstream_enzymes/.test(t)).slice(0, 1),
    );
  }
  if (/condition|定量|fold|treatment/i.test(q)) {
    push(
      lang === "zh" ? "定量条件" : "Conditions",
      "condition",
      lang === "zh" ? "条件倍数" : "Fold changes",
      available.filter((t) => /get_site_conditions/.test(t)).slice(0, 1),
    );
  }
  if (/function|disease|疾病|drug|药/i.test(q) || steps.length < 2) {
    push(
      lang === "zh" ? "功能与疾病" : "Function & disease",
      "function",
      lang === "zh" ? "功能/疾病" : "Function/disease",
      available.filter((t) => /get_function_disease|get_drug_ptm/.test(t)).slice(0, 2),
    );
  }
  if (!steps.length) {
    push(
      lang === "zh" ? "综合检索" : "Broad search",
      "site",
      lang === "zh" ? "广搜" : "Broad",
      available.slice(0, 4),
    );
  }
  return { summary: question, steps };
}

export async function* commitIntentResult(
  tool: string,
  result: QptmToolResult,
  outcome: StepOutcome,
  memory: InvestigationMemory,
  artifacts: ArtifactStore,
  citations: Citation[],
  state: DrResearchState,
): AsyncGenerator<AgentEvent, void> {
  applyResolvedIdentity(memory, result);
  const kindTag = result.error_kind ? ` [${result.error_kind}]` : "";
  addFinding(memory, tool, `${result.summary}${kindTag}`);
  recordOutcome(state, outcome);
  state.toolsUsed.push(tool);
  const empty = isEmptyToolResult(result);
  if (!empty) {
    artifacts.add("db_result", tool, result.summary, { tool });
    if (result.success) mergeCitation(citations, tool);
  }
  yield {
    type: "tool_result",
    payload: {
      tool_name: tool,
      success: result.success,
      summary: result.summary,
      error_kind: result.error_kind,
      data_count: empty ? 0 : 1,
    },
    kind: "database",
  };
}

export async function* runBreadthPlanExecute(
  userMessage: string,
  memory: InvestigationMemory,
  session: SessionState,
  skills: string,
  catalog: string,
  lang: "zh" | "en",
  artifacts: ArtifactStore,
  citations: Citation[],
  state: DrResearchState,
): AsyncGenerator<AgentEvent> {
  yield setPhase(
    session,
    AgentPhase.breadth,
    lang === "zh" ? "广搜多个 PTM 数据库" : "Broad database search",
  );
  yield setPhase(session, AgentPhase.planning, lang === "zh" ? "制定调研计划" : "Planning research");

  const plan = await buildPlan(userMessage, memory, skills, catalog, lang, state);
  yield {
    type: "plan_created",
    plan: {
      intent_summary: plan.summary,
      steps: plan.steps.map((s) => ({
        step: s.step,
        title: s.title,
        description: s.rationale,
        database: s.entity,
        status: "pending",
      })),
    },
  };

  yield setPhase(session, AgentPhase.database, lang === "zh" ? "执行数据库调研" : "Database investigation");

  for (const step of plan.steps) {
    const tools = [...new Set(step.tools.filter(Boolean))];
    for (const tool of tools) {
      yield {
        type: "tool_call",
        tool_name: tool,
        arguments: { entity: step.entity, query: userMessage },
        kind: "database",
      };
    }
    const results = await Promise.all(
      tools.map((tool) => executeIntent(tool, memory, userMessage)),
    );
    for (const { tool, result, outcome } of results) {
      yield* commitIntentResult(tool, result, outcome, memory, artifacts, citations, state);
    }
  }
}

export function buildDepthQuery(
  focus: string,
  memory: InvestigationMemory,
  question: string,
): string {
  const gene = memory.gene || "";
  const site = memory.position ? `S${memory.position}` : "";
  const base = `${gene} ${site}`.trim();
  const f = focus.toLowerCase();
  if (/kinase|regulat|upstream|enzyme|e3|writer|调控|激酶/.test(f)) {
    return `${base} kinase phosphorylation regulation`.trim();
  }
  if (/condition|fold|treatment|when|条件|定量/.test(f)) {
    return `${base} phosphorylation treatment cell line fold change`.trim();
  }
  if (/disease|cancer|突变|疾病/.test(f)) {
    return `${base} phosphorylation disease cancer mutation`.trim();
  }
  if (/drug|inhibitor|药/.test(f)) {
    return `${base} phosphorylation drug inhibitor sensitivity`.trim();
  }
  if (/llps|相分离|phase/.test(f)) {
    return `${base} phosphorylation phase separation LLPS`.trim();
  }
  if (/local|定位|compartment|domain/.test(f)) {
    return `${base} phosphorylation localization subcellular`.trim();
  }
  if (/function|功能|stability|稳定/.test(f)) {
    return `${base} phosphorylation function mechanism`.trim();
  }
  return `${base} ${focus}`.trim() || question;
}

export async function* runDepthSearch(
  userMessage: string,
  memory: InvestigationMemory,
  session: SessionState,
  lang: "zh" | "en",
  artifacts: ArtifactStore,
  citations: Citation[],
  state: DrResearchState,
  focus: string,
  queryOverride?: string,
): AsyncGenerator<AgentEvent> {
  state.depthSearched = true;
  yield setPhase(
    session,
    AgentPhase.depth,
    lang === "zh" ? "深挖文献与补充证据" : "Depth search: literature & gaps",
  );
  yield setPhase(session, AgentPhase.literature, lang === "zh" ? "文献检索" : "Literature search");

  const q = (queryOverride || buildDepthQuery(focus, memory, userMessage)).trim();
  const start = Date.now();
  const lit = await searchLiteratureArticles(q);
  const found = (lit.match(/PMID[:\s]*(\d{7,8})/gi) || []).length;
  artifacts.add("literature_search", q, lit.slice(0, 2000), {
    pmids: [...lit.matchAll(/(\d{7,8})/g)].slice(0, 10).map((m) => m[1]),
  });
  mergeCitation(citations, "search_literature");
  state.toolsUsed.push("search_literature");

  yield {
    type: "literature_search",
    round: 1,
    query: q,
    papers_found: found,
    elapsed_s: (Date.now() - start) / 1000,
  };

  const pmids: string[] = [];
  for (const m of lit.matchAll(/(\d{7,8})/g)) {
    if (pmids.length < 3) pmids.push(m[1]);
  }

  for (const pmid of pmids) {
    const viaPubmed = await callQptmTool("search_literature", {
      ...intentArgs(memory, userMessage),
      pmids: pmid,
      query: q,
    });
    let abstract = "";
    if (viaPubmed.success || viaPubmed.summary) {
      abstract = `${viaPubmed.summary || ""}\n${JSON.stringify(viaPubmed.data ?? {})}`;
    } else {
      abstract = await biomcpGetArticle(`pmid:${pmid}`);
    }
    artifacts.add("paper", `PMID:${pmid}`, abstract.slice(0, 2000), { pmids: [pmid] });
  }

  const outcome: StepOutcome = {
    tool: "depth_search",
    success: found > 0 || pmids.length > 0,
    empty: found === 0 && pmids.length === 0,
    callBug: false,
    predictedOnly: false,
    summary: `depth_search focus=${focus} query=${q.slice(0, 120)} papers=${found}`,
  };
  recordOutcome(state, outcome);
}

export const SUPERVISOR_META_TOOLS = [
  "breadth_search",
  "depth_search",
  "web_search",
  "finish_research",
] as const;

export async function buildSupervisorTools(state: DrResearchState): Promise<OpenAI.Chat.ChatCompletionTool[]> {
  const catalog = await listMcpTools();
  const meta: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "breadth_search",
        description: "BFRS: generate a goal-driven plan and parallel-query MCP intent tools across PTM databases.",
        parameters: { type: "object", properties: { note: { type: "string" } } },
      },
    },
    {
      type: "function",
      function: {
        name: "depth_search",
        description: "DFRS: targeted literature search for a gap dimension (kinase, condition, disease, drug, localization, llps, function).",
        parameters: {
          type: "object",
          properties: {
            focus: { type: "string", description: "Gap dimension: kinase, condition, disease, drug, localization, llps, function" },
            query: { type: "string", description: "Optional specific PubMed query" },
          },
          required: ["focus"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Targeted web search for a specific mechanistic gap (not generic PTM site).",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish_research",
        description: "End investigation and proceed to report synthesis when all asked dimensions have non-predicted evidence.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  const intents = catalog
    .filter((t) => mayRecallIntent(t.name, state.emptyTools, state.succeededTools))
    .filter((t) => t.name !== "resolve_ptm_target")
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description || `qPTM intent: ${t.name}`,
        parameters: t.inputSchema || { type: "object", properties: { query: { type: "string" } } },
      },
    }));

  return [...meta, ...intents];
}

function supervisorSystemPrompt(lang: "zh" | "en", skills: string, memory: InvestigationMemory): string {
  const base =
    lang === "zh"
      ? `你是 PTM 深度调研调度器（supervisor），不是写报告的人。使用 ptm-databases 维度地图判断每个研究方面是否已有实验/策展证据。
规则：
1. 有 gene/site 时首轮优先 breadth_search；之后默认至少一轮 depth_search 补缺口。
2. finish_research 仅当用户问到的每个维度都有非空、非纯预测证据，且无未解释 call_bug。
3. empty_result 的 intent 禁止重打；已成功 intent 禁止重打。
4. 某维度空/仅预测/call_bug 时必须按该维度 depth_search，不能用其它维度充实代替 finish。
5. web_search 必须具体，禁止笼统「PTM site」。
已解析：${memoryPromptBlock(memory)}`
      : `You are the PTM deep-research supervisor (not the report writer). Use the ptm-databases dimension map to judge whether each research aspect has experimental/curated evidence.
Rules:
1. Prefer breadth_search first when gene/site known; default to depth_search after breadth for gaps.
2. finish_research only when every dimension the user asked about has non-empty, non-predicted evidence and no unexplained call_bug.
3. Never re-call empty_result or already-succeeded intents.
4. If a dimension is empty/predicted-only/call_bug, depth_search that dimension — do not finish because another dimension is rich.
5. web_search must be specific — never generic "PTM site".
Resolved: ${memoryPromptBlock(memory)}`;
  return `${base}\n\n${skills}`;
}

export async function* runSupervisorLoop(
  userMessage: string,
  memory: InvestigationMemory,
  session: SessionState,
  skills: string,
  catalog: string,
  lang: "zh" | "en",
  artifacts: ArtifactStore,
  citations: Citation[],
  state: DrResearchState,
): AsyncGenerator<AgentEvent> {
  const llm = getLlm();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: supervisorSystemPrompt(lang, skills, memory) },
    {
      role: "user",
      content:
        lang === "zh"
          ? `调研问题：${userMessage}\n\n开始调度。gap_score=${gapScore(state.outcomes).toFixed(2)}`
          : `Research question: ${userMessage}\n\nBegin supervision. gap_score=${gapScore(state.outcomes).toFixed(2)}`,
    },
  ];

  let finished = false;

  for (let round = 0; round < cfg.drSupervisorMaxRounds && !finished; round++) {
    yield setPhase(
      session,
      AgentPhase.supervising,
      lang === "zh" ? "评估证据，决定下一步" : "Evaluating evidence, choosing next step",
    );

    const tools = await buildSupervisorTools(state);
    const { content, toolCalls } = await llm.chatCompletion(messages, {
      tools,
      maxTokens: 1200,
      temperature: 0.25,
    });

    if (!toolCalls.length) {
      if (content?.toLowerCase().includes("finish")) finished = true;
      break;
    }

    const wantsFinish = toolCalls.some((tc) => tc.name === "finish_research");
    const actionable = toolCalls.filter((tc) => tc.name !== "finish_research");

    if (wantsFinish && !actionable.length) {
      const gap = gapScore(state.outcomes);
      if (state.outcomes.length > 0 && gap < 0.5) {
        finished = true;
        break;
      }
      messages.push({
        role: "assistant",
        content: content || "finish rejected",
      });
      messages.push({
        role: "user",
        content:
          lang === "zh"
            ? `证据仍有缺口（gap=${gap.toFixed(2)}）。请 breadth_search 或 depth_search。\n${outcomesSummary(state.outcomes)}`
            : `Gaps remain (gap=${gap.toFixed(2)}). Use breadth_search or depth_search.\n${outcomesSummary(state.outcomes)}`,
      });
      continue;
    }

    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
      })),
    });

    const toolResultById = new Map<string, string>();

    for (const tc of actionable) {
      if (tc.name === "breadth_search") {
        yield {
          type: "tool_call",
          tool_name: "breadth_search",
          arguments: tc.arguments || {},
          kind: "database",
        };
        yield* runBreadthPlanExecute(
          userMessage,
          memory,
          session,
          skills,
          catalog,
          lang,
          artifacts,
          citations,
          state,
        );
        toolResultById.set(tc.id, `breadth_search done. ${outcomesSummary(state.outcomes)}`);
        continue;
      }

      if (tc.name === "depth_search") {
        const focus = String(tc.arguments?.focus || "function");
        const query = tc.arguments?.query ? String(tc.arguments.query) : undefined;
        yield {
          type: "tool_call",
          tool_name: "depth_search",
          arguments: { focus, query },
          kind: "database",
        };
        yield* runDepthSearch(
          userMessage,
          memory,
          session,
          lang,
          artifacts,
          citations,
          state,
          focus,
          query,
        );
        toolResultById.set(tc.id, `depth_search focus=${focus}`);
        continue;
      }

      if (tc.name === "web_search") {
        const q = String(tc.arguments?.query || "").trim();
        if (q) {
          yield {
            type: "tool_call",
            tool_name: "web_search",
            arguments: { query: q },
            kind: "database",
          };
          const web = await webSearch(q);
          if (web && !web.startsWith("Web search failed")) {
            artifacts.add("web_search", q, web.slice(0, 1500));
            state.toolsUsed.push("web_search");
          }
          toolResultById.set(tc.id, `web_search: ${web.slice(0, 200)}`);
        } else {
          toolResultById.set(tc.id, "web_search skipped — empty query");
        }
        continue;
      }

      if (mayRecallIntent(tc.name, state.emptyTools, state.succeededTools)) {
        yield {
          type: "tool_call",
          tool_name: tc.name,
          arguments: tc.arguments || {},
          kind: "database",
        };
        const { tool, result, outcome } = await executeIntent(tc.name, memory, userMessage);
        yield* commitIntentResult(tool, result, outcome, memory, artifacts, citations, state);
        toolResultById.set(tc.id, `[${tool}] ${outcome.summary}`);
      } else {
        toolResultById.set(tc.id, `[${tc.name}] skipped — already empty or succeeded`);
      }
    }

    const gap = gapScore(state.outcomes);
    const canFinish = state.outcomes.length > 0 && gap < 0.5;
    for (const tc of toolCalls) {
      if (tc.name === "finish_research") {
        toolResultById.set(
          tc.id,
          canFinish
            ? "finish_research accepted — proceeding to synthesis"
            : `finish_research rejected — gap=${gap.toFixed(2)}; use breadth_search or depth_search`,
        );
      }
    }

    for (const tc of toolCalls) {
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResultById.get(tc.id) || "(no result)",
      });
    }

    if (wantsFinish && canFinish) {
      finished = true;
      break;
    }

    messages.push({
      role: "user",
      content:
        lang === "zh"
          ? `gap_score=${gap.toFixed(2)}\n${outcomesSummary(state.outcomes)}\n继续调度或 finish_research。`
          : `gap_score=${gap.toFixed(2)}\n${outcomesSummary(state.outcomes)}\nContinue or finish_research.`,
    });
  }
}
