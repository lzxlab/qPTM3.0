import OpenAI from "openai";
import { cfg } from "../config.js";
import { compactDbPayload } from "../context/artifacts.js";
import { addFinding } from "../context/memory.js";
import type { SessionState } from "../context/session.js";
import {
  callQptmTool,
  isWebSearchFailure,
  listMcpTools,
  webSearch,
  type QptmToolResult,
} from "../mcp/hub.js";
import { loadSkills, skillsForMode } from "../skills/loader.js";
import { getLlm } from "../llm/client.js";
import type { AgentEvent } from "../sse.js";
import { mergeCitation, type Citation } from "./citations.js";
import { ANSWER_LANGUAGE_RULE, detectLang } from "./gate.js";
import { retrieveIntentToolsLlm } from "./retriever.js";
import { applyResolvedIdentity } from "./resolve-target.js";
import {
  containsProtocolMarkup,
  sanitizeUserVisibleText,
  stripProtocolMarkup,
} from "./protocol.js";
import { AgentPhase, setPhase } from "./phase.js";
import { buildIntentArgs } from "./dr-research-loop.js";
import { isEmptyToolResult } from "./tool-result.js";
import { callSearchLiteratureDeep } from "./literature-fetch.js";
import { extractPmids, papersFromToolResult } from "./literature.js";
import {
  emptyCallKey,
  formatToolObservation,
  followableEntitiesFromPayload,
} from "./observation.js";

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

function resultRowCount(result: QptmToolResult, empty: boolean): number {
  if (empty) return 0;
  const payload = compactDbPayload(result);
  if (!payload) return 1;
  return payload.blocks.reduce((n, b) => n + (b.shown || b.rows.length || 0), 0) || 1;
}

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
            pmids: { type: "string" },
            fulltext_pmids: { type: "string" },
          },
        },
      },
    };
  });
}

function reactSystemPrompt(): string {
  return `You are the qPTM PTM research assistant. You are the only scheduler: decide whether to answer now or call tools.

Rules:
1. Greetings, help, or capability questions: answer directly with no tools. Steer toward PTM site questions (e.g. AKT1 S473, TP53 S15).
2. Off-topic (not molecular/cell biology, protein, or PTM): briefly refuse and steer to PTM research. No tools.
3. Biology concepts: you may answer from knowledge. Call tools only if a lookup would materially help.
4. If a site-level question is missing gene/protein or residue, ask in natural language. Do not invent a UniProt AC.
5. Evidence-seeking questions: call bound database tools. Independent lookups should be parallel in one turn.
6. Keep going until you can support the answer or the tools came back empty. Say empty honestly — never pretend a lookup succeeded.
7. [empty_result]=no records; [truncated]=raise limit or add sources; [predicted_only]=not experimental; [call_bug]=failed.
8. Follow entities in observations to tighten the next query or pick another intent. Do not repeat the exact same empty call.
9. Literature queries must be specific (gene + site + mechanism). Never search generic "PTM site". search_literature already returns top abstracts; request fulltext_pmids only for a few key papers.
10. web_search is optional and specific — not a generic PTM search.
11. Never emit protocol markup, tool XML, or DSML. User-visible text is natural language only.
${ANSWER_LANGUAGE_RULE}`;
}

export async function* runReactLoop(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  session: SessionState,
): AsyncGenerator<AgentEvent> {
  const memory = session.memory;
  const artifacts = session.artifacts;
  const lang = detectLang(userMessage);
  const citations: Citation[] = [...session.citations];
  const skills = loadSkills(skillsForMode("react", userMessage));
  const toolsUsed: string[] = [];
  const emptyKeys = new Set<string>();
  const usedExact = new Set<string>();

  yield setPhase(session, AgentPhase.retrieving_tools, "Selecting tools");
  const catalog = await listMcpTools();
  const selected = await retrieveIntentToolsLlm(userMessage, memory, catalog);
  const bound = selected.filter((n) => n !== "web_search");
  yield {
    type: "phase_update",
    phase: AgentPhase.retrieving_tools,
    label: bound.length ? `Tools: ${bound.join(", ")}` : "No tools needed",
    detail: bound.length ? bound.join(", ") : "TOOLS: []",
  };

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${reactSystemPrompt()}\n\n${skills.slice(0, 5000)}` },
    ...history.slice(-8).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    {
      role: "user",
      content: `Memory: gene=${memory.gene || ""} UniProt=${memory.uniprot_ac || ""} site=${memory.position || ""} ptm=${memory.ptm_type || ""}
Findings: ${memory.findings_summary || "(none)"}
Question: ${userMessage}`,
    },
  ];

  const llm = getLlm();
  let draftAnswer = "";

  for (let round = 0; round < cfg.reactMaxRounds; round++) {
    const tools: OpenAI.Chat.ChatCompletionTool[] = bound.length ? await llmToolsFor(bound) : [];
    if (!usedExact.has("web_search")) tools.push(WEB_SEARCH_TOOL);

    const { content, toolCalls, reasoning } = await llm.chatCompletion(messages, {
      tools: tools.length ? tools : undefined,
      maxTokens: 4096,
      temperature: 0.3,
    });

    const thought = stripProtocolMarkup(reasoning || (toolCalls.length ? content || "" : "")).text.trim();
    if (thought) {
      yield {
        type: "phase_update",
        phase: AgentPhase.database,
        label: toolCalls.length ? "Choosing next lookup" : "Writing answer",
        detail: thought,
      };
      if (!toolCalls.length) {
        yield { type: "report_thought", content: thought };
      }
    }

    const allowed = new Set<string>([...bound, "web_search"]);
    const calls = toolCalls.filter((tc) => allowed.has(tc.name));
    if (calls.length) {
      const nextPhase = calls.some((c) => c.name === "search_literature")
        ? AgentPhase.literature
        : AgentPhase.database;
      yield setPhase(session, nextPhase, "Querying evidence");
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        })),
      });

      for (const tc of calls) {
        yield {
          type: "tool_call",
          tool_name: tc.name,
          arguments: tc.arguments || {},
          kind: tc.name === "search_literature" || tc.name === "web_search" ? "literature" : "database",
        };
      }

      const executed = await Promise.all(
        calls.map(async (tc) => {
          if (tc.name === "web_search") {
            const q = String(tc.arguments?.query || "").trim();
            const web = q ? await webSearch(q) : "Web search unavailable: empty query";
            return { tc, kind: "web" as const, q, web };
          }
          const args = buildIntentArgs(memory, userMessage, tc.arguments);
          const key = emptyCallKey(tc.name, args);
          if (emptyKeys.has(key)) {
            return {
              tc,
              kind: "mcp" as const,
              args,
              result: {
                success: false,
                summary: "Skipped: same arguments already returned [empty_result]",
                data: null,
                error_kind: "empty_result" as const,
              } satisfies QptmToolResult,
              skipped: true,
            };
          }
          const result =
            tc.name === "search_literature"
              ? await callSearchLiteratureDeep(args)
              : await callQptmTool(tc.name, args);
          return { tc, kind: "mcp" as const, args, result, skipped: false };
        }),
      );

      for (const item of executed) {
        if (item.kind === "web") {
          const ok = Boolean(item.web) && !isWebSearchFailure(item.web);
          if (ok) artifacts.add("web_search", item.q, item.web.slice(0, 1500));
          usedExact.add("web_search");
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
            kind: "literature",
          };
          continue;
        }

        const result = item.result;
        applyResolvedIdentity(memory, result);
        const empty = isEmptyToolResult(result);
        const payload = compactDbPayload(result);
        if (empty) emptyKeys.add(emptyCallKey(item.tc.name, item.args));
        addFinding(
          memory,
          item.tc.name,
          `${result.summary}${result.error_kind ? ` [${result.error_kind}]` : ""}`,
        );
        if (!empty) {
          if (item.tc.name === "search_literature") {
            const papers = papersFromToolResult(result);
            const pmids = papers.map((p) => p.pmid).filter(Boolean);
            artifacts.add("literature_search", String(item.args.query || userMessage), result.summary, {
              tool: "search_literature",
              arguments: item.args,
              pmids,
              payload,
            });
            for (const p of papers) {
              if (!p.abstract && !p.fulltext) continue;
              artifacts.add(
                "paper",
                `PMID:${p.pmid}`,
                [`PMID:${p.pmid}`, p.title, p.abstract, p.fulltext].filter(Boolean).join("\n").slice(0, cfg.litAbstractMaxChars),
                { pmids: [p.pmid] },
              );
            }
            yield {
              type: "literature_search",
              round: round + 1,
              query: item.args.query || userMessage,
              papers_found: pmids.length || extractPmids(result.summary).length,
              elapsed_s: 0,
            };
            if (result.success) mergeCitation(citations, "search_literature");
          } else {
            artifacts.add("db_result", item.tc.name, result.summary, {
              tool: item.tc.name,
              arguments: item.args,
              payload,
            });
            if (result.success) mergeCitation(citations, item.tc.name);
          }
        }
        if (!toolsUsed.includes(item.tc.name)) toolsUsed.push(item.tc.name);
        const entities = followableEntitiesFromPayload(payload, [memory.gene || ""]);
        const observation = formatToolObservation(
          item.tc.name,
          result,
          payload,
          entities,
          [memory.gene || ""],
        );
        messages.push({
          role: "tool",
          tool_call_id: item.tc.id,
          content: observation,
        });
        yield {
          type: "tool_result",
          payload: {
            tool_name: item.tc.name,
            success: result.success,
            summary: result.summary,
            error_kind: result.error_kind,
            data_count: resultRowCount(result, empty),
          },
          kind: item.tc.name === "search_literature" ? "literature" : "database",
        };
      }
      continue;
    }

    if (content && !containsProtocolMarkup(content)) {
      draftAnswer = content;
      break;
    }
    if (content) {
      draftAnswer = sanitizeUserVisibleText(content, lang);
      break;
    }
  }

  session.citations = citations;
  yield {
    type: "_react_finished",
    answer: draftAnswer,
    toolsUsed,
    citations,
  };
}
