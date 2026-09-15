import OpenAI from "openai";
import { cfg } from "../config.js";
import { ArtifactStore, compactDbPayload } from "../context/artifacts.js";
import { addFinding, InvestigationMemory, mergeEntities, parseEntities } from "../context/memory.js";
import { SessionState } from "../context/session.js";
import {
  callQptmTool,
  listMcpTools,
  searchLiteratureArticles,
  readQptmResource,
  isWebSearchFailure,
  webSearch,
} from "../mcp/hub.js";
import { loadSkills, skillsForMode } from "../skills/loader.js";
import { getLlm } from "../llm/client.js";
import type { AgentEvent } from "../sse.js";
import { mergeCitation, type Citation } from "./citations.js";
import {
  classifyQueryMode,
  detectLang,
  gateReply,
  needsLiterature,
  ptmResearchSteer,
  ANSWER_LANGUAGE_RULE,
} from "./gate.js";
import { retrieveIntentTools } from "./retriever.js";
import { generateFollowUps, ptmSteerFollowUps } from "./followups.js";
import {
  applyResolvedIdentity,
  resolveSessionTarget,
} from "./resolve-target.js";
import {
  containsProtocolMarkup,
  failedGenerationMessage,
  sanitizeUserVisibleText,
  stripProtocolMarkup,
} from "./protocol.js";
import { isEmptyToolResult } from "./tool-result.js";
import { AgentPhase, setPhase } from "./phase.js";
import { buildIntentArgs } from "./dr-research-loop.js";

function resultRowCount(result: Awaited<ReturnType<typeof callQptmTool>>, empty: boolean): number {
  if (empty) return 0;
  const payload = compactDbPayload(result);
  if (!payload) return 1;
  return payload.blocks.reduce((n, b) => n + (b.shown || b.rows.length || 0), 0) || 1;
}

type ToolExec = {
  summary: string;
  tool: string;
  success: boolean;
  error_kind?: string | null;
  empty: boolean;
};

const WEB_SEARCH_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Optional targeted web search. Call only when the user's intent needs timely web context or a mechanistic gap databases did not cover — never a generic PTM site query.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Specific search query rewritten from the user's intent" } },
      required: ["query"],
    },
  },
};

async function llmToolsFor(names: string[]): Promise<OpenAI.Chat.ChatCompletionTool[]> {
  const catalog = await listMcpTools();
  return names.map((name) => {
    const meta = catalog.find((t) => t.name === name);
    return {
      type: "function" as const,
      function: {
        name,
        description: meta?.description || `qPTM MCP intent tool: ${name}`,
        parameters: meta?.inputSchema || {
          type: "object",
          properties: {
            query: { type: "string" },
            gene: { type: "string" },
            position: { type: "integer" },
            uniprot_ac: { type: "string" },
            ptm_type: { type: "string" },
            limit: { type: "integer" },
          },
        },
      },
    };
  });
}

async function executeQptmTool(
  toolHint: string,
  question: string,
  memory: InvestigationMemory,
  artifacts: ArtifactStore,
  citations: Citation[],
  extra?: Record<string, unknown> | null,
): Promise<ToolExec> {
  const { args, result } = await callQptmToolRaw(toolHint, question, memory, extra);
  return commitToolResult(toolHint, question, memory, artifacts, citations, args, result);
}

function commitToolResult(
  toolHint: string,
  question: string,
  memory: InvestigationMemory,
  artifacts: ArtifactStore,
  citations: Citation[],
  args: Record<string, unknown>,
  result: Awaited<ReturnType<typeof callQptmTool>>,
): ToolExec {
  applyResolvedIdentity(memory, result);
  const summary = result.summary || "done";
  const kindTag = result.error_kind ? ` [${result.error_kind}]` : "";
  addFinding(memory, toolHint, `${summary}${kindTag}`);
  const empty = isEmptyToolResult(result);
  if (!empty) {
    artifacts.add("db_result", `${toolHint}: ${question}`, summary, {
      tool: toolHint,
      arguments: args,
      payload: compactDbPayload(result),
    });
    if (result.success) mergeCitation(citations, toolHint);
  }
  return {
    summary,
    tool: toolHint,
    success: result.success,
    error_kind: result.error_kind,
    empty,
  };
}

async function callQptmToolRaw(
  toolHint: string,
  question: string,
  memory: InvestigationMemory,
  extra?: Record<string, unknown> | null,
): Promise<{ args: Record<string, unknown>; result: Awaited<ReturnType<typeof callQptmTool>> }> {
  const args = buildIntentArgs(memory, question, extra);
  const result = await callQptmTool(toolHint, args);
  return { args, result };
}

export async function* runQA(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  session: SessionState,
): AsyncGenerator<AgentEvent> {
  const memory = session.memory;
  const artifacts = session.artifacts;
  const lang = detectLang(userMessage);
  const parsed = parseEntities(userMessage);
  mergeEntities(memory, parsed, userMessage);
  memory.query_mode = classifyQueryMode(userMessage, parsed);

  yield setPhase(session, AgentPhase.planning, "Understanding question");

  const gate = gateReply(memory.query_mode as Parameters<typeof gateReply>[0], lang);
  if (gate) {
    yield setPhase(session, AgentPhase.synthesis, "Reply");
    yield { type: "text", content: gate };
    yield { type: "follow_up_questions", questions: ptmSteerFollowUps(lang) };
    yield { type: "done" };
    return;
  }

  const skills = loadSkills(skillsForMode("qa", userMessage));

  if (memory.query_mode === "concept") {
    yield setPhase(session, AgentPhase.synthesis, "Writing answer");
    const raw = await synthesizeConcept(userMessage, history, skills, lang);
    const answer = ensurePtmSteer(sanitizeUserVisibleText(raw, lang), lang);
    for (const chunk of chunkText(answer)) yield { type: "text", content: chunk };
    const followUps = ptmSteerFollowUps(lang);
    yield { type: "follow_up_questions", questions: followUps };
    yield { type: "done" };
    return;
  }

  yield setPhase(session, AgentPhase.retrieving_tools, "Preparing tools");
  const sourcesCatalog = await readQptmResource("qptm://sources");

  const toolsUsed: string[] = [];
  const citations: Citation[] = [...session.citations];

  if (artifacts.shouldSkipLiteratureSearch(userMessage)) {
    yield setPhase(
      session,
      AgentPhase.synthesis,
      "Answering from cached literature",
    );
    const litCtx = artifacts.getLiteratureContext();
    yield {
      type: "synthesis_started",
      evidence: {
        db_results: artifacts.findDbResults().length,
        db_rows: artifacts.dbRowCount(),
        literature: artifacts.findLiterature().length,
        web_search: artifacts.findWebSearch().length,
        citations: citations.length,
        catalog: artifacts.catalogForPrompt(8, { skipEmpty: true }),
      },
    };
    const synth = await finalizeQaAnswer(
      () => synthesizeQA(userMessage, history, memory, skills, sourcesCatalog, litCtx, citations, lang),
      memory,
      lang,
    );
    if (synth.reasoning) {
      yield { type: "report_thought", content: stripProtocolMarkup(synth.reasoning).text };
    }
    for (const chunk of chunkText(synth.content)) yield { type: "text", content: chunk };
    yield { type: "sources", citations };
    const followUps = await generateFollowUps(userMessage, synth.content, memory, artifacts, "qa", toolsUsed);
    yield { type: "follow_up_questions", questions: followUps };
    session.citations = citations;
    yield { type: "done" };
    return;
  }

  yield setPhase(session, AgentPhase.database, "Querying databases");

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

  const toolList = retrieveIntentTools(userMessage, memory, 4);
  const bootstrap = toolList.slice(0, 3);

  for (const tool of bootstrap) {
    yield {
      type: "tool_call",
      tool_name: tool,
      arguments: {
        query: userMessage,
        gene: memory.gene,
        uniprot_ac: memory.uniprot_ac,
        position: memory.position,
      },
      kind: "database",
    };
  }

  const bootRaw = await Promise.all(
    bootstrap.map((tool) => callQptmToolRaw(tool, userMessage, memory)),
  );
  const bootResults = bootRaw.map((raw, i) =>
    commitToolResult(bootstrap[i], userMessage, memory, artifacts, citations, raw.args, raw.result),
  );
  for (let i = 0; i < bootResults.length; i++) {
    const r = bootResults[i];
    toolsUsed.push(r.tool);
    yield {
      type: "tool_result",
      payload: {
        tool_name: r.tool,
        success: r.success,
        summary: r.summary,
        error_kind: r.error_kind,
        data_count: resultRowCount(bootRaw[i].result, r.empty),
      },
      kind: "database",
    };
  }

  const used = new Set(toolsUsed);
  const llm = getLlm();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are a qPTM biology expert. Some database results are already collected. Call remaining database tools only if critical evidence is missing; otherwise answer concisely. Never emit protocol markup.
Tags: [empty_result]=no records; [missing_params]=need args; [call_bug]=failed. If the target is resolved, do not say UniProt AC is missing.
web_search is optional. Decide from the user's meaning and the database results — not from keyword triggers. Skip textbook definitions and site facts the databases already answer. Call it when the question needs timely web context (news, clinical or product updates) or a mechanistic gap the databases did not cover. Write a specific query from the user's intent; never a generic "PTM site" search; do not paste the whole user question if a tighter query would work.
${ANSWER_LANGUAGE_RULE}`,
    },
    ...history.slice(-6).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    {
      role: "user",
      content: [
        skills.slice(0, 4000),
        `Memory: gene=${memory.gene || ""} UniProt=${memory.uniprot_ac || ""} site=${memory.position || ""}`,
        memory.findings_summary,
        `Question: ${userMessage}`,
      ].join("\n\n"),
    },
  ];

  let llmAnswer = "";
  let webSummary = "";
  for (let round = 0; round < cfg.qaMaxRounds; round++) {
    const remaining = toolList.filter((t) => !used.has(t));
    const tools: OpenAI.Chat.ChatCompletionTool[] = remaining.length
      ? await llmToolsFor(remaining)
      : [];
    if (!used.has("web_search")) tools.push(WEB_SEARCH_TOOL);
    const { content, toolCalls, reasoning } = await llm.chatCompletion(messages, {
      tools: tools.length ? tools : undefined,
      maxTokens: 4096,
      temperature: 0.35,
    });

    const rationale = stripProtocolMarkup(reasoning || "").text.trim();
    const callNote = toolCalls.length ? stripProtocolMarkup(content || "").text.trim() : "";
    const thought = rationale || callNote;
    if (thought) {
      yield {
        type: "phase_update",
        phase: AgentPhase.database,
        label: "Choosing next lookup",
        detail: thought,
      };
    }

    const allowedNames = new Set<string>(toolList);
    const remainingNames = new Set<string>(remaining);
    const allowedCalls = toolCalls.filter((tc) => {
      if (tc.name === "web_search") return !used.has("web_search");
      return remainingNames.has(tc.name) || allowedNames.has(tc.name);
    });
    if (allowedCalls.length) {
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: allowedCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        })),
      });

      for (const tc of allowedCalls) {
        yield {
          type: "tool_call",
          tool_name: tc.name,
          arguments: tc.arguments || {},
          kind: "database",
        };
      }

      const extraRaw = await Promise.all(
        allowedCalls.map(async (tc) => {
          if (tc.name === "web_search") {
            const q = String(tc.arguments?.query || "").trim();
            const web = q ? await webSearch(q) : "Web search unavailable: empty query";
            return { kind: "web" as const, tc, q, web };
          }
          const q = String(tc.arguments?.query || userMessage);
          const raw = await callQptmToolRaw(tc.name, q, memory, tc.arguments);
          return { kind: "mcp" as const, tc, q, raw };
        }),
      );
      for (const item of extraRaw) {
        if (item.kind === "web") {
          const ok = Boolean(item.web) && !isWebSearchFailure(item.web);
          if (ok) {
            webSummary = item.web;
            artifacts.add("web_search", item.q, item.web.slice(0, 1500));
          }
          used.add("web_search");
          toolsUsed.push("web_search");
          messages.push({
            role: "tool",
            tool_call_id: item.tc.id,
            content: ok ? item.web.slice(0, 2000) : item.web,
          });
          yield {
            type: "tool_result",
            payload: {
              tool_name: "web_search",
              success: ok,
              summary: ok ? item.web.slice(0, 400) : item.web,
              error_kind: ok ? null : "tool_error",
              data_count: ok ? 1 : 0,
            },
            kind: "database",
          };
          continue;
        }
        const r = commitToolResult(
          item.tc.name,
          item.q,
          memory,
          artifacts,
          citations,
          item.raw.args,
          item.raw.result,
        );
        used.add(r.tool);
        toolsUsed.push(r.tool);
        messages.push({
          role: "tool",
          tool_call_id: item.tc.id,
          content: `${r.summary}${r.error_kind ? ` [${r.error_kind}]` : ""}`,
        });
        yield {
          type: "tool_result",
          payload: {
            tool_name: r.tool,
            success: r.success,
            summary: r.summary,
            error_kind: r.error_kind,
            data_count: resultRowCount(item.raw.result, r.empty),
          },
          kind: "database",
        };
      }
      continue;
    }

    if (content && !containsProtocolMarkup(content)) {
      llmAnswer = content;
      break;
    }
    if (content) {
      llmAnswer = sanitizeUserVisibleText(content, lang);
      break;
    }
  }

  let litSummary = "";
  if (needsLiterature(userMessage)) {
    yield setPhase(session, AgentPhase.literature, "Searching literature");
    const start = Date.now();
    litSummary = await searchLiteratureArticles(userMessage, cfg.litSearchLimit);
    const elapsed = (Date.now() - start) / 1000;
    artifacts.add("literature_search", userMessage, litSummary.slice(0, 8000));
    yield {
      type: "literature_search",
      round: 1,
      query: userMessage,
      papers_found: (litSummary.match(/PMID/gi) || []).length,
      elapsed_s: elapsed,
    };
    mergeCitation(citations, "pubtator_literature_search");
  }

  yield setPhase(session, AgentPhase.synthesis, "Writing answer");
  const extraCtx = [
    litSummary,
    webSummary,
    artifacts.catalogForPrompt(12, { skipEmpty: true }),
    artifacts.rowsForPrompt(8000),
  ]
    .filter(Boolean)
    .join("\n---\n");

  yield {
    type: "synthesis_started",
    evidence: {
      db_results: artifacts.findDbResults().length,
      db_rows: artifacts.dbRowCount(),
      literature: artifacts.findLiterature().length,
      web_search: artifacts.findWebSearch().length,
      citations: citations.length,
      catalog: artifacts.catalogForPrompt(8, { skipEmpty: true }),
    },
  };

  let answer: string;
  if (llmAnswer && !litSummary && !webSummary) {
    answer = sanitizeUserVisibleText(llmAnswer, lang);
  } else {
    const synth = await finalizeQaAnswer(
      () => synthesizeQA(userMessage, history, memory, skills, sourcesCatalog, extraCtx, citations, lang),
      memory,
      lang,
    );
    if (synth.reasoning) {
      yield { type: "report_thought", content: stripProtocolMarkup(synth.reasoning).text };
    }
    answer = synth.content;
  }
  for (const chunk of chunkText(answer)) yield { type: "text", content: chunk };

  yield { type: "sources", citations };
  session.citations = citations;

  const followUps = await generateFollowUps(userMessage, answer, memory, artifacts, "qa", toolsUsed);
  yield { type: "follow_up_questions", questions: followUps };
  yield { type: "done" };
}

async function finalizeQaAnswer(
  synthesize: () => Promise<{ content: string; reasoning: string }>,
  memory: InvestigationMemory,
  lang: "zh" | "en",
): Promise<{ content: string; reasoning: string }> {
  let raw = await synthesize();
  let sanitized = sanitizeUserVisibleText(raw.content, lang);
  if (containsProtocolMarkup(raw.content) && sanitized === failedGenerationMessage(lang)) {
    raw = await synthesize();
    sanitized = sanitizeUserVisibleText(raw.content, lang);
  }
  return { content: sanitized, reasoning: raw.reasoning || "" };
}

async function synthesizeQA(
  question: string,
  history: Array<{ role: string; content: string }>,
  memory: InvestigationMemory,
  skills: string,
  sourcesCatalog: string,
  extraEvidence: string,
  citations: Citation[],
  lang: "zh" | "en",
): Promise<{ content: string; reasoning: string }> {
  const citeList = citations.map((c) => `${c.id}: ${c.database}`).join(", ");
  const system = `You are qPTM biology expert. Answer concisely; distinguish experimental vs predicted evidence. Cite databases (${citeList}). No lengthy reviews.
Tool tags: [empty_result]=no records in DB (not a missing ID); [missing_params]=need more arguments; [call_bug]=call failed. If gene/UniProt/site is already resolved, do NOT say UniProt AC is missing.
Never emit DSML, tool_calls, function_call, XML tool invocations, or other protocol markup — only user-facing natural language.
${ANSWER_LANGUAGE_RULE}`;

  const userBlock = [
    skills,
    `Sources catalog:\n${sourcesCatalog.slice(0, 4000)}`,
    `Memory: gene=${memory.gene || ""} UniProt=${memory.uniprot_ac || ""} site=${memory.position || ""} ptm=${memory.ptm_type || ""}`,
    memory.findings_summary,
    extraEvidence ? `Evidence:\n${extraEvidence.slice(0, 6000)}` : "",
    `Question: ${question}`,
  ].join("\n\n");

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...history.slice(-8).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userBlock },
  ];

  const llm = getLlm();
  const { content, reasoning } = await llm.chatCompletion(messages, { maxTokens: 4096, temperature: 0.35 });
  return { content, reasoning: reasoning || "" };
}

async function synthesizeConcept(
  question: string,
  history: Array<{ role: string; content: string }>,
  skills: string,
  lang: "zh" | "en",
): Promise<string> {
  const system = `You are the **qPTM PTM research assistant**. You may first explain molecular and cell-biology concepts (proteins, genes, cells, PTMs).
Do NOT refuse biology-related questions. Be clear and structured.
End with 2–4 sentences that steer the user into **PTM research**: how this concept connects to PTMs/qPTM, plus 1–2 askable site examples (e.g. AKT1 S473, TP53 S15). Do not use a "Next steps" heading or a numbered list — the UI shows follow-up chips separately.
${ANSWER_LANGUAGE_RULE}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...history.slice(-8).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: `${skills}\n\nQuestion: ${question}` },
  ];

  const llm = getLlm();
  const { content } = await llm.chatCompletion(messages, { maxTokens: 4096, temperature: 0.35 });
  return content;
}

function ensurePtmSteer(text: string, lang: "zh" | "en"): string {
  const t = (text || "").trim();
  if (!t) return ptmResearchSteer(lang);
  if (/AKT1 S473|TP53 S15|qPTM/i.test(t) && /PTM|翻译后修饰|post-translational|磷酸化/i.test(t)) {
    return t;
  }
  return `${t}\n\n${ptmResearchSteer(lang)}`;
}

function chunkText(text: string, size = 80): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
