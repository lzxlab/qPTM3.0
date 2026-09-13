import { cfg } from "../config.js";
import { addFinding, mergeEntities, parseEntities } from "../context/memory.js";
import { callQptmTool, listMcpTools, searchLiteratureArticles, readQptmResource, webSearch, } from "../mcp/hub.js";
import { loadSkills, skillsForMode } from "../skills/loader.js";
import { getLlm } from "../llm/client.js";
import { mergeCitation } from "./citations.js";
import { classifyQueryMode, detectLang, gateReply, needsLiterature, needsWebSearch, ptmResearchSteer, } from "./gate.js";
import { retrieveIntentTools } from "./retriever.js";
import { generateFollowUps, ptmSteerFollowUps } from "./followups.js";
import { applyResolvedIdentity, resolveSessionTarget, resolvedBanner, } from "./resolve-target.js";
import { containsProtocolMarkup, failedGenerationMessage, sanitizeUserVisibleText, } from "./protocol.js";
import { isEmptyToolResult } from "./tool-result.js";
import { AgentPhase, setPhase } from "./phase.js";
async function llmToolsFor(names) {
    const catalog = await listMcpTools();
    return names.map((name) => {
        const meta = catalog.find((t) => t.name === name);
        return {
            type: "function",
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
async function executeQptmTool(toolHint, question, memory, artifacts, citations, entityHint) {
    const { args, result } = await callQptmToolRaw(toolHint, question, memory, entityHint);
    return commitToolResult(toolHint, question, memory, artifacts, citations, args, result);
}
function commitToolResult(toolHint, question, memory, artifacts, citations, args, result) {
    applyResolvedIdentity(memory, result);
    const summary = result.summary || "done";
    const kindTag = result.error_kind ? ` [${result.error_kind}]` : "";
    addFinding(memory, toolHint, `${summary}${kindTag}`);
    const empty = isEmptyToolResult(result);
    if (!empty) {
        artifacts.add("db_result", `${toolHint}: ${question}`, summary, { tool: toolHint, arguments: args });
        if (result.success)
            mergeCitation(citations, toolHint);
    }
    return {
        summary,
        tool: toolHint,
        success: result.success,
        error_kind: result.error_kind,
        empty,
    };
}
async function callQptmToolRaw(toolHint, question, memory, _entityHint) {
    const args = {
        query: question,
        gene: memory.gene || "",
        position: memory.position || 0,
        uniprot_ac: memory.uniprot_ac || "",
        ptm_type: memory.ptm_type || "phosphorylation",
        limit: 15,
    };
    const result = await callQptmTool(toolHint, args);
    return { args, result };
}
export async function* runQA(userMessage, history, session) {
    const memory = session.memory;
    const artifacts = session.artifacts;
    const lang = detectLang(userMessage);
    const parsed = parseEntities(userMessage);
    mergeEntities(memory, parsed, userMessage);
    memory.query_mode = classifyQueryMode(userMessage, parsed);
    yield setPhase(session, AgentPhase.planning, lang === "zh" ? "理解问题" : "Understanding question");
    const gate = gateReply(memory.query_mode, lang);
    if (gate) {
        yield setPhase(session, AgentPhase.synthesis, lang === "zh" ? "回复" : "Reply");
        yield { type: "text", content: gate };
        yield { type: "follow_up_questions", questions: ptmSteerFollowUps(lang) };
        yield { type: "done" };
        return;
    }
    const skills = loadSkills(skillsForMode("qa", userMessage));
    if (memory.query_mode === "concept") {
        yield setPhase(session, AgentPhase.synthesis, lang === "zh" ? "撰写回答" : "Writing answer");
        const raw = await synthesizeConcept(userMessage, history, skills, lang);
        const answer = ensurePtmSteer(sanitizeUserVisibleText(raw, lang), lang);
        for (const chunk of chunkText(answer))
            yield { type: "text", content: chunk };
        const followUps = ptmSteerFollowUps(lang);
        yield { type: "follow_up_questions", questions: followUps };
        yield { type: "done" };
        return;
    }
    yield setPhase(session, AgentPhase.retrieving_tools, lang === "zh" ? "准备工具" : "Preparing tools");
    const sourcesCatalog = await readQptmResource("qptm://sources");
    const toolsUsed = [];
    const citations = [...session.citations];
    if (artifacts.shouldSkipLiteratureSearch(userMessage)) {
        yield setPhase(session, AgentPhase.synthesis, lang === "zh" ? "基于已有文献回答" : "Answering from cached literature");
        const litCtx = artifacts.getLiteratureContext();
        const synth = await finalizeQaAnswer(() => synthesizeQA(userMessage, history, memory, skills, sourcesCatalog, litCtx, citations, lang), memory, lang);
        for (const chunk of chunkText(synth))
            yield { type: "text", content: chunk };
        yield { type: "sources", citations };
        const followUps = await generateFollowUps(userMessage, synth, memory, artifacts, "qa", toolsUsed);
        yield { type: "follow_up_questions", questions: followUps };
        session.citations = citations;
        yield { type: "done" };
        return;
    }
    yield setPhase(session, AgentPhase.database, lang === "zh" ? "查询数据库" : "Querying databases");
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
    const bootRaw = await Promise.all(bootstrap.map((tool) => callQptmToolRaw(tool, userMessage, memory)));
    const bootResults = bootRaw.map((raw, i) => commitToolResult(bootstrap[i], userMessage, memory, artifacts, citations, raw.args, raw.result));
    for (const r of bootResults) {
        toolsUsed.push(r.tool);
        yield {
            type: "tool_result",
            payload: {
                tool_name: r.tool,
                success: r.success,
                summary: r.summary,
                error_kind: r.error_kind,
                data_count: r.empty ? 0 : 1,
            },
            kind: "database",
        };
    }
    const used = new Set(toolsUsed);
    const llm = getLlm();
    const messages = [
        {
            role: "system",
            content: lang === "zh"
                ? `你是 qPTM 生物学专家。已有部分数据库结果。若仍缺关键证据，调用剩余工具；否则直接给出简洁回答。区分实验与预测。不要输出 DSML/tool_calls 协议文本。
工具标注：[empty_result]=库中无记录；[missing_params]=缺参；[call_bug]=失败。已解析靶点不得再说缺少 UniProt AC。`
                : `You are a qPTM biology expert. Some database results are already collected. Call remaining tools only if critical evidence is missing; otherwise answer concisely. Never emit protocol markup.
Tags: [empty_result]=no records; [missing_params]=need args; [call_bug]=failed. If the target is resolved, do not say UniProt AC is missing.`,
        },
        ...history.slice(-6).map((h) => ({
            role: h.role,
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
    for (let round = 0; round < cfg.qaMaxRounds; round++) {
        const remaining = toolList.filter((t) => !used.has(t));
        const tools = remaining.length ? await llmToolsFor(remaining) : undefined;
        const { content, toolCalls } = await llm.chatCompletion(messages, {
            tools,
            maxTokens: 2048,
            temperature: 0.35,
        });
        const allowedNames = new Set(toolList);
        const remainingNames = new Set(remaining);
        const allowedCalls = toolCalls.filter((tc) => remainingNames.has(tc.name) || allowedNames.has(tc.name));
        if (allowedCalls.length) {
            messages.push({
                role: "assistant",
                content: content || null,
                tool_calls: allowedCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
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
            const extraRaw = await Promise.all(allowedCalls.map((tc) => {
                const q = String(tc.arguments?.query || userMessage);
                return callQptmToolRaw(tc.name, q, memory).then((raw) => ({ tc, q, raw }));
            }));
            const extraResults = extraRaw.map(({ tc, q, raw }) => commitToolResult(tc.name, q, memory, artifacts, citations, raw.args, raw.result));
            for (let i = 0; i < extraResults.length; i++) {
                const r = extraResults[i];
                const tc = allowedCalls[i];
                used.add(r.tool);
                toolsUsed.push(r.tool);
                messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: `${r.summary}${r.error_kind ? ` [${r.error_kind}]` : ""}`,
                });
                yield {
                    type: "tool_result",
                    payload: {
                        tool_name: r.tool,
                        success: r.success,
                        summary: r.summary,
                        error_kind: r.error_kind,
                        data_count: r.empty ? 0 : 1,
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
        yield setPhase(session, AgentPhase.literature, lang === "zh" ? "检索文献" : "Searching literature");
        const start = Date.now();
        litSummary = await searchLiteratureArticles(userMessage);
        const elapsed = (Date.now() - start) / 1000;
        artifacts.add("literature_search", userMessage, litSummary.slice(0, 1500));
        yield {
            type: "literature_search",
            round: 1,
            query: userMessage,
            papers_found: (litSummary.match(/PMID/gi) || []).length,
            elapsed_s: elapsed,
        };
        mergeCitation(citations, "pubtator_literature_search");
    }
    let webSummary = "";
    if (needsWebSearch(userMessage)) {
        webSummary = await webSearch(userMessage);
        artifacts.add("web_search", userMessage, webSummary.slice(0, 1500));
    }
    yield setPhase(session, AgentPhase.synthesis, lang === "zh" ? "撰写回答" : "Writing answer");
    const extraCtx = [litSummary, webSummary, artifacts.catalogForPrompt(12, { skipEmpty: true })]
        .filter(Boolean)
        .join("\n---\n");
    let answer;
    if (llmAnswer && !litSummary && !webSummary) {
        answer = resolvedBanner(memory, lang) + sanitizeUserVisibleText(llmAnswer, lang);
    }
    else {
        answer = await finalizeQaAnswer(() => synthesizeQA(userMessage, history, memory, skills, sourcesCatalog, extraCtx, citations, lang), memory, lang);
    }
    for (const chunk of chunkText(answer))
        yield { type: "text", content: chunk };
    yield { type: "sources", citations };
    session.citations = citations;
    const followUps = await generateFollowUps(userMessage, answer, memory, artifacts, "qa", toolsUsed);
    yield { type: "follow_up_questions", questions: followUps };
    yield { type: "done" };
}
async function finalizeQaAnswer(synthesize, memory, lang) {
    let raw = await synthesize();
    let sanitized = sanitizeUserVisibleText(raw, lang);
    if (containsProtocolMarkup(raw) && sanitized === failedGenerationMessage(lang)) {
        raw = await synthesize();
        sanitized = sanitizeUserVisibleText(raw, lang);
    }
    return resolvedBanner(memory, lang) + sanitized;
}
async function synthesizeQA(question, history, memory, skills, sourcesCatalog, extraEvidence, citations, lang) {
    const citeList = citations.map((c) => `${c.id}: ${c.database}`).join(", ");
    const system = lang === "zh"
        ? `你是 qPTM 生物学专家助手，只回答生物学问题。回答简洁准确，区分实验数据与预测结果。引用数据库名（${citeList}）。不要冗长综述。
工具结果标注含义：[empty_result]=库中无记录，不是缺参数；[missing_params]=缺少参数；[call_bug]=调用失败。已解析的靶点（gene/UniProt/site）不得再说“缺少 UniProt AC”。
禁止输出 DSML、tool_calls、function_call、XML 工具调用等协议 markup；只输出给用户看的自然语言回答。`
        : `You are qPTM biology expert. Answer concisely; distinguish experimental vs predicted evidence. Cite databases (${citeList}). No lengthy reviews.
Tool tags: [empty_result]=no records in DB (not a missing ID); [missing_params]=need more arguments; [call_bug]=call failed. If gene/UniProt/site is already resolved, do NOT say UniProt AC is missing.
Never emit DSML, tool_calls, function_call, XML tool invocations, or other protocol markup — only user-facing natural language.`;
    const userBlock = [
        skills,
        `Sources catalog:\n${sourcesCatalog.slice(0, 4000)}`,
        `Memory: gene=${memory.gene || ""} UniProt=${memory.uniprot_ac || ""} site=${memory.position || ""} ptm=${memory.ptm_type || ""}`,
        memory.findings_summary,
        extraEvidence ? `Evidence:\n${extraEvidence.slice(0, 6000)}` : "",
        `Question: ${question}`,
    ].join("\n\n");
    const messages = [
        { role: "system", content: system },
        ...history.slice(-8).map((h) => ({
            role: h.role,
            content: h.content,
        })),
        { role: "user", content: userBlock },
    ];
    const llm = getLlm();
    const { content } = await llm.chatCompletion(messages, { maxTokens: 2048, temperature: 0.35 });
    return content;
}
async function synthesizeConcept(question, history, skills, lang) {
    const system = lang === "zh"
        ? `你是 **qPTM 的 PTM 研究助手**，也可以先讲清分子与细胞生物学概念（蛋白质、基因、细胞、翻译后修饰等）。
**不要**拒绝生物学相关问题。回答清晰、结构化。
文末必须用 2–4 句把用户引向 **翻译后修饰（PTM）研究**：说明该概念与 PTM/qPTM 的关系，并给出 1–2 个可直接提问的位点例子（如 AKT1 S473、TP53 S15）。不要用「后续问题」标题、不要列编号清单——界面会另给推荐问题。`
        : `You are the **qPTM PTM research assistant**. You may first explain molecular and cell-biology concepts (proteins, genes, cells, PTMs).
Do NOT refuse biology-related questions. Be clear and structured.
End with 2–4 sentences that steer the user into **PTM research**: how this concept connects to PTMs/qPTM, plus 1–2 askable site examples (e.g. AKT1 S473, TP53 S15). Do not use a "Next steps" heading or a numbered list — the UI shows follow-up chips separately.`;
    const messages = [
        { role: "system", content: system },
        ...history.slice(-8).map((h) => ({
            role: h.role,
            content: h.content,
        })),
        { role: "user", content: `${skills}\n\nQuestion: ${question}` },
    ];
    const llm = getLlm();
    const { content } = await llm.chatCompletion(messages, { maxTokens: 2048, temperature: 0.35 });
    return content;
}
function ensurePtmSteer(text, lang) {
    const t = (text || "").trim();
    if (!t)
        return ptmResearchSteer(lang);
    if (/AKT1 S473|TP53 S15|qPTM/i.test(t) && /PTM|翻译后修饰|post-translational|磷酸化/i.test(t)) {
        return t;
    }
    return `${t}\n\n${ptmResearchSteer(lang)}`;
}
function chunkText(text, size = 80) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size)
        chunks.push(text.slice(i, i + size));
    return chunks;
}
