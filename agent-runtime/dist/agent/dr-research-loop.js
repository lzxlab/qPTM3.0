import { cfg } from "../config.js";
import { compactDbPayload } from "../context/artifacts.js";
import { memoryPromptBlock } from "../context/memory.js";
import { callQptmTool, listMcpTools, searchLiteratureArticles, isWebSearchFailure, webSearch, } from "../mcp/hub.js";
import { getLlm } from "../llm/client.js";
import { mergeCitation } from "./citations.js";
import { AgentPhase, setPhase } from "./phase.js";
import { stripProtocolMarkup } from "./protocol.js";
import { retrieveIntentToolsDeep } from "./retriever.js";
import { applyResolvedIdentity } from "./resolve-target.js";
import { addFinding } from "../context/memory.js";
import { gapScore, isCallBug, isEmptyToolResult, mayRecallIntent, outcomesSummary, toStepOutcome, wantsIntentExpand, } from "./tool-result.js";
import { extractPmids, geneLikeTokens, literatureTokens, papersFromToolResult, rankLiteraturePapers, normalizeLitQuery, withFrontierEntities, entitiesMissingFromQuery, } from "./literature.js";
export const DEFAULT_INTENT_LIMIT = 15;
export const MAX_INTENT_LIMIT = 200;
export function createDrState() {
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
export function seedDrStateFromArtifacts(artifacts) {
    const state = createDrState();
    for (const a of artifacts.findDbResults()) {
        const tool = a.tool || a.query;
        if (!tool)
            continue;
        const blocks = a.payload?.blocks || [];
        const predictedOnly = blocks.length > 0 && blocks.every((b) => String(b.evidence_level || "").toLowerCase() === "predicted");
        recordOutcome(state, {
            tool,
            success: !predictedOnly,
            empty: false,
            callBug: false,
            predictedOnly,
            summary: (a.summary || "").slice(0, 400),
        });
        if (!state.toolsUsed.includes(tool))
            state.toolsUsed.push(tool);
    }
    return state;
}
export function shouldAcceptFinish(_state, _artifacts) {
    return true;
}
export function buildIntentArgs(memory, question, extra) {
    const fallbackQuery = [memory.gene, memory.position ? `S${memory.position}` : "", memory.ptm_type].filter(Boolean).join(" ") ||
        question;
    const extraQuery = extra?.query != null ? String(extra.query).trim() : "";
    const args = {
        query: extraQuery || question || fallbackQuery,
        gene: memory.gene || extra?.gene || "",
        position: memory.position || extra?.position || 0,
        uniprot_ac: memory.uniprot_ac || extra?.uniprot_ac || "",
        ptm_type: extra?.ptm_type || memory.ptm_type || "phosphorylation",
        limit: DEFAULT_INTENT_LIMIT,
    };
    if (!extra)
        return args;
    for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || v === null || v === "")
            continue;
        if (k === "query")
            continue;
        if (k === "limit") {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) {
                args.limit = Math.min(MAX_INTENT_LIMIT, Math.max(1, Math.floor(n)));
            }
            continue;
        }
        if ((k === "gene" || k === "position" || k === "uniprot_ac") && args[k])
            continue;
        args[k] = v;
    }
    return args;
}
function recordOutcome(state, outcome) {
    state.outcomes.push(outcome);
    if (outcome.empty)
        state.emptyTools.add(outcome.tool);
    else if (outcome.callBug)
        state.callBugTools.add(outcome.tool);
    else if (outcome.predictedOnly)
        state.predictedOnlyTools.add(outcome.tool);
    else if (outcome.success)
        state.succeededTools.add(outcome.tool);
}
export async function executeIntent(tool, memory, question, extra, retryOnBug = true) {
    const args = buildIntentArgs(memory, question, extra);
    let result = await callQptmTool(tool, args);
    if (retryOnBug && isCallBug(result)) {
        result = await callQptmTool(tool, args);
    }
    return { tool, result, outcome: toStepOutcome(tool, result) };
}
function intentArgs(memory, question, extra) {
    return buildIntentArgs(memory, question, extra);
}
export async function buildPlan(question, memory, skills, catalog, lang, state) {
    const available = retrieveIntentToolsDeep(question, memory).filter((t) => mayRecallIntent(t, state.emptyTools, state.succeededTools));
    const excludeNote = state.outcomes.length
        ? `\nAlready tried: empty=[${[...state.emptyTools].join(",")}] ok=[${[...state.succeededTools].join(",")}]`
        : "";
    const prompt = `Create a JSON plan for PTM deep research. Use the dimension map — schedule only intents matching the user's question; no WHO/WHEN/WHERE/WHY labels.
Question: ${question}
Context: ${memoryPromptBlock(memory)}
Tools: ${available.join(", ")}${excludeNote}

Output: {"summary":"...","steps":[{"step":1,"title":"theme","entity":"...","tools":["intent_name"],"rationale":"why"}]}
Max 6 steps.`;
    try {
        const llm = getLlm();
        const { content } = await llm.chatCompletion([
            { role: "system", content: `${skills}\n${catalog.slice(0, 3000)}` },
            { role: "user", content: prompt },
        ], { maxTokens: 1200, temperature: 0.2 });
        const parsed = JSON.parse(content.replace(/```json?\s*|\s*```/g, "").trim());
        if (parsed.steps?.length) {
            const steps = parsed.steps.slice(0, cfg.drMaxPlanSteps).map((s, i) => ({
                ...s,
                step: i + 1,
                tools: (s.tools || []).filter((t) => mayRecallIntent(t, state.emptyTools, state.succeededTools)),
            }));
            return { summary: parsed.summary || question, steps: steps.filter((s) => s.tools.length) };
        }
    }
    catch {
        /* fallback */
    }
    const q = question.toLowerCase();
    const steps = [];
    const push = (title, entity, rationale, slice) => {
        if (!slice.length)
            return;
        steps.push({ step: steps.length + 1, title, entity, tools: slice, rationale });
    };
    push("Site context", "site", "Target context", available.filter((t) => /search_ptm_sites|get_localization/.test(t)).slice(0, 2));
    if (/kinase|激酶|调控|enzyme|e3/i.test(q)) {
        push("Upstream regulation", "kinase", "Kinase evidence", available.filter((t) => /get_upstream_enzymes/.test(t)).slice(0, 1));
    }
    if (/condition|定量|fold|treatment/i.test(q)) {
        push("Conditions", "condition", "Fold changes", available.filter((t) => /get_site_conditions/.test(t)).slice(0, 1));
    }
    if (/function|disease|疾病|drug|药/i.test(q) || steps.length < 2) {
        push("Function & disease", "function", "Function/disease", available.filter((t) => /get_function_disease|get_drug_ptm/.test(t)).slice(0, 2));
    }
    if (!steps.length) {
        push("Broad search", "site", "Broad", available.slice(0, 4));
    }
    return { summary: question, steps };
}
export function flattenPlanIntents(steps, emptyTools, succeededTools) {
    const out = [];
    const seen = new Set();
    for (const step of steps) {
        for (const t of step.tools || []) {
            if (!t || seen.has(t))
                continue;
            if (!mayRecallIntent(t, emptyTools, succeededTools))
                continue;
            seen.add(t);
            out.push(t);
        }
    }
    return out;
}
export function planLiteratureFocuses(steps) {
    const seen = new Set();
    const focuses = [];
    for (const s of steps) {
        const e = String(s.entity || "")
            .toLowerCase()
            .trim();
        if (!e || e === "site" || e === "broad")
            continue;
        if (seen.has(e))
            continue;
        seen.add(e);
        focuses.push(e);
    }
    return focuses;
}
export function intentForFocus(focus) {
    const f = focus.toLowerCase();
    if (/kinase|regulat|upstream|enzyme|e3|writer|调控|激酶/.test(f))
        return "get_upstream_enzymes";
    if (/condition|fold|treatment|when|条件|定量/.test(f))
        return "get_site_conditions";
    if (/drug|inhibitor|药/.test(f))
        return "get_drug_ptm";
    if (/llps|相分离|phase/.test(f))
        return "get_llps";
    if (/local|定位|compartment|domain/.test(f))
        return "get_localization";
    if (/disease|cancer|突变|疾病|function|功能|stability|稳定/.test(f))
        return "get_function_disease";
    return undefined;
}
export async function* commitIntentResult(tool, result, outcome, memory, artifacts, citations, state) {
    applyResolvedIdentity(memory, result);
    const kindTag = result.error_kind ? ` [${result.error_kind}]` : "";
    addFinding(memory, tool, `${result.summary}${kindTag}`);
    recordOutcome(state, outcome);
    state.toolsUsed.push(tool);
    const empty = isEmptyToolResult(result);
    const payload = compactDbPayload(result);
    const dataCount = payload
        ? payload.blocks.reduce((n, b) => n + (b.shown || b.rows.length || 0), 0)
        : empty
            ? 0
            : 1;
    if (!empty) {
        artifacts.add("db_result", tool, result.summary, { tool, payload });
        if (result.success)
            mergeCitation(citations, tool);
    }
    yield {
        type: "tool_result",
        payload: {
            tool_name: tool,
            success: result.success,
            summary: result.summary,
            error_kind: result.error_kind,
            data_count: dataCount,
        },
        kind: "database",
    };
}
export async function* runBreadthPlanExecute(userMessage, memory, session, skills, catalog, lang, artifacts, citations, state) {
    yield setPhase(session, AgentPhase.breadth, "BFS: databases then shallow literature");
    yield setPhase(session, AgentPhase.planning, "Planning research");
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
                tools: s.tools,
                status: "pending",
            })),
        },
    };
    for (const s of plan.steps) {
        yield { type: "step_started", step: s.step, title: s.title, status: "running" };
    }
    const tools = flattenPlanIntents(plan.steps, state.emptyTools, state.succeededTools);
    yield setPhase(session, AgentPhase.database, "BFS layer 1: parallel databases");
    for (const tool of tools) {
        yield {
            type: "tool_call",
            tool_name: tool,
            arguments: { query: userMessage },
            kind: "database",
        };
    }
    if (tools.length) {
        const results = await Promise.all(tools.map((tool) => executeIntent(tool, memory, userMessage)));
        for (const { tool, result, outcome } of results) {
            yield* commitIntentResult(tool, result, outcome, memory, artifacts, citations, state);
            const step = plan.steps.find((s) => (s.tools || []).includes(tool));
            if (step) {
                yield {
                    type: "step_completed",
                    step: step.step,
                    title: step.title,
                    status: outcome.empty ? "empty" : "done",
                };
            }
        }
    }
    const entities = artifacts.frontierEntities(8, [memory.gene || ""]);
    const focuses = planLiteratureFocuses(plan.steps);
    const litQueries = (focuses.length ? focuses : ["function"]).map((focus) => withFrontierEntities(buildDepthQuery(focus, memory, userMessage), entities));
    const uniqueQueries = [...new Set(litQueries.map((q) => q.trim()).filter(Boolean))].filter((q) => !artifacts.hasLiteratureQuery(q));
    yield setPhase(session, AgentPhase.literature, "BFS layer 2: shallow literature");
    if (uniqueQueries.length) {
        const started = Date.now();
        const cap = Math.max(1, Math.min(cfg.litBreadthLimit, 20));
        const hits = await Promise.all(uniqueQueries.map(async (q) => {
            const lit = await searchLiteratureArticles(q, cap);
            return { q, lit, pmids: extractPmids(lit, cap) };
        }));
        for (const { q, lit, pmids } of hits) {
            artifacts.add("literature_search", q, lit.slice(0, 4000), { pmids });
            state.toolsUsed.push("search_literature");
            yield {
                type: "literature_search",
                round: 0,
                query: q,
                papers_found: pmids.length,
                elapsed_s: (Date.now() - started) / 1000,
            };
        }
        mergeCitation(citations, "search_literature");
    }
}
export function buildDepthQuery(focus, memory, question, entities = []) {
    const gene = memory.gene || "";
    const site = memory.position ? `S${memory.position}` : "";
    const base = `${gene} ${site}`.trim();
    const f = focus.toLowerCase();
    let q = "";
    if (/kinase|regulat|upstream|enzyme|e3|writer|调控|激酶/.test(f)) {
        q = `${base} kinase phosphorylation regulation`;
    }
    else if (/condition|fold|treatment|when|条件|定量/.test(f)) {
        q = `${base} phosphorylation treatment cell line fold change`;
    }
    else if (/disease|cancer|突变|疾病/.test(f)) {
        q = `${base} phosphorylation disease cancer mutation`;
    }
    else if (/drug|inhibitor|药/.test(f)) {
        q = `${base} phosphorylation drug inhibitor sensitivity`;
    }
    else if (/llps|相分离|phase/.test(f)) {
        q = `${base} phosphorylation phase separation LLPS`;
    }
    else if (/local|定位|compartment|domain/.test(f)) {
        q = `${base} phosphorylation localization subcellular`;
    }
    else if (/function|功能|stability|稳定/.test(f)) {
        q = `${base} phosphorylation function mechanism`;
    }
    else {
        q = `${base} ${focus}`.trim() || question;
    }
    return withFrontierEntities(q.trim(), entities);
}
export async function* runDepthSearch(userMessage, memory, session, lang, artifacts, citations, state, focus, queryOverride) {
    state.depthSearched = true;
    yield setPhase(session, AgentPhase.depth, "DFS: one focus branch");
    yield {
        type: "step_started",
        step: 0,
        title: `DFS: ${focus}`,
        status: "running",
    };
    const focusIntent = intentForFocus(focus);
    if (focusIntent && mayRecallIntent(focusIntent, state.emptyTools, state.succeededTools)) {
        yield {
            type: "tool_call",
            tool_name: focusIntent,
            arguments: { query: userMessage, focus },
            kind: "database",
        };
        const { tool, result, outcome } = await executeIntent(focusIntent, memory, userMessage);
        yield* commitIntentResult(tool, result, outcome, memory, artifacts, citations, state);
    }
    yield setPhase(session, AgentPhase.literature, "DFS literature");
    const frontier = artifacts.frontierEntities(8, [memory.gene || ""]);
    const baseQ = (queryOverride || buildDepthQuery(focus, memory, userMessage)).trim();
    const q1 = withFrontierEntities(baseQ, frontier);
    const start = Date.now();
    const searchCap = cfg.litSearchLimit;
    const absCap = cfg.litAbstractLimit;
    const allPmids = [];
    const seenPmid = new Set();
    const addPmids = (ids) => {
        for (const id of ids) {
            if (seenPmid.has(id))
                continue;
            seenPmid.add(id);
            allPmids.push(id);
        }
    };
    const runSearch = async (q) => {
        if (!q || artifacts.hasLiteratureQuery(q))
            return [];
        const lit = await searchLiteratureArticles(q, searchCap);
        const pmids = extractPmids(lit, searchCap);
        artifacts.add("literature_search", q, lit.slice(0, 8000), { pmids: pmids.slice(0, absCap) });
        state.toolsUsed.push("search_literature");
        return pmids;
    };
    const pmids1 = await runSearch(q1);
    addPmids(pmids1);
    yield {
        type: "literature_search",
        round: 1,
        query: q1,
        papers_found: pmids1.length,
        elapsed_s: (Date.now() - start) / 1000,
    };
    let papers = papersFromToolResult({ success: true, summary: "", data: null });
    const fetchAbstracts = async (pmids, query) => {
        const batch = pmids.filter(Boolean).slice(0, absCap);
        if (!batch.length)
            return;
        const absResult = await callQptmTool("search_literature", {
            ...intentArgs(memory, userMessage),
            query,
            pmids: batch.join(","),
            max_chars: cfg.litAbstractMaxChars,
        });
        const fromAbs = papersFromToolResult(absResult);
        for (const p of fromAbs) {
            const i = papers.findIndex((x) => x.pmid === p.pmid);
            if (i >= 0)
                papers[i] = { ...papers[i], ...p, abstract: p.abstract || papers[i].abstract };
            else
                papers.push(p);
            const blob = [`PMID:${p.pmid}`, p.title, p.abstract].filter(Boolean).join("\n");
            artifacts.add("paper", `PMID:${p.pmid}`, blob.slice(0, cfg.litAbstractMaxChars), { pmids: [p.pmid] });
        }
    };
    await fetchAbstracts(pmids1, q1);
    const fromPapers = geneLikeTokens(papers.map((p) => `${p.title} ${p.abstract}`).join(" "), [memory.gene || ""], 8);
    const round2Entities = entitiesMissingFromQuery(q1, [...frontier, ...fromPapers]);
    let q2 = "";
    if (cfg.litDepthRounds >= 2 && pmids1.length && round2Entities.length) {
        q2 = withFrontierEntities(buildDepthQuery(focus, memory, userMessage), round2Entities);
        if (normalizeLitQuery(q2) !== normalizeLitQuery(q1) && !artifacts.hasLiteratureQuery(q2)) {
            const pmids2 = await runSearch(q2);
            const fresh = pmids2.filter((id) => !seenPmid.has(id));
            addPmids(pmids2);
            yield {
                type: "literature_search",
                round: 2,
                query: q2,
                papers_found: pmids2.length,
                elapsed_s: (Date.now() - start) / 1000,
            };
            await fetchAbstracts(fresh, q2);
        }
    }
    mergeCitation(citations, "search_literature");
    const tokens = literatureTokens(memory, focus, `${userMessage} ${frontier.join(" ")}`);
    const ranked = rankLiteraturePapers(papers, tokens, memory.gene);
    const ftTargets = ranked.slice(0, cfg.litFulltextLimit).map((p) => p.pmid);
    if (ftTargets.length) {
        const ftResult = await callQptmTool("search_literature", {
            ...intentArgs(memory, userMessage),
            query: q2 || q1,
            fulltext_pmids: ftTargets.join(","),
        });
        const ftPapers = papersFromToolResult(ftResult);
        for (const p of ftPapers) {
            if (!p.fulltext)
                continue;
            artifacts.add("paper", `PMID:${p.pmid} fulltext`, [`PMID:${p.pmid}`, p.title, p.fulltext].filter(Boolean).join("\n").slice(0, cfg.litFulltextMaxChars), { pmids: [p.pmid] });
        }
    }
    const outcome = {
        tool: "depth_search",
        success: allPmids.length > 0 || papers.length > 0,
        empty: allPmids.length === 0 && papers.length === 0,
        callBug: false,
        predictedOnly: false,
        summary: `depth_search focus=${focus} q1=${q1.slice(0, 80)} papers=${allPmids.length} abstracts=${papers.length}`,
    };
    recordOutcome(state, outcome);
    yield {
        type: "step_completed",
        step: 0,
        title: `DFS: ${focus}`,
        status: outcome.empty ? "empty" : "done",
    };
}
export const SUPERVISOR_META_TOOLS = [
    "breadth_search",
    "depth_search",
    "web_search",
    "finish_research",
];
export async function buildSupervisorTools(state) {
    const catalog = await listMcpTools();
    const meta = [
        {
            type: "function",
            function: {
                name: "breadth_search",
                description: "BFS: one parallel database layer for the dimensions the user asked, then shallow literature (titles/PMIDs) using entities from those hits. Use for multi-dimension or survey questions — not a single kinase lookup.",
                parameters: { type: "object", properties: { note: { type: "string" } } },
            },
        },
        {
            type: "function",
            function: {
                name: "depth_search",
                description: "DFS: drill one gap dimension (kinase, condition, disease, drug, localization, llps, function) — focus DB if missing, then up to two entity-tight literature rounds with abstracts and OA full text. Do not call once per empty dimension.",
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
                description: "End investigation and write the report. Use when the current user question can be answered from collected (or prior-turn) evidence. Do not force extra database or literature searches.",
                parameters: { type: "object", properties: {} },
            },
        },
    ];
    const intents = catalog
        .filter((t) => !state.emptyTools.has(t.name))
        .filter((t) => t.name !== "resolve_ptm_target")
        .map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description || `qPTM intent: ${t.name}`,
            parameters: t.inputSchema || { type: "object", properties: { query: { type: "string" } } },
        },
    }));
    return [...meta, ...intents];
}
function supervisorSystemPrompt(skills, memory) {
    const base = `You are the PTM deep-research supervisor (not the report writer). Coordinate the fewest tools needed for THIS user turn.
Principles:
1. Prefer a direct MCP intent when the question is one dimension (kinase/upstream → get_upstream_enzymes; conditions → get_site_conditions; disease → get_function_disease). Do not default to breadth_search then depth_search.
2. breadth_search = BFS for multi-dimension or survey questions: parallel databases then shallow literature. Call it at most once this turn.
3. depth_search = DFS for ONE known gap (empty DB, predicted-only, or the user asked for mechanism/papers). Pass focus. After breadth, at most one depth_search on the most important gap — never one depth per empty dimension.
4. If prior database rows already answer a follow-up (list / filter / explain last hits), finish_research. Re-call the same intent only when results were truncated and the user wants the full set (higher limit or sources).
5. If the user names a source (e.g. qPTM only), pass sources on that intent. To list the full hit set, raise limit (max 200).
6. Do not re-call empty_result intents. Do not re-call succeeded intents unless expanding with a new limit or sources.
7. web_search is independent and optional — specific mechanistic queries only, never generic "PTM site", not part of breadth/depth.
Resolved: ${memoryPromptBlock(memory)}`;
    return `${base}\n\n${skills}`;
}
export async function* runSupervisorLoop(userMessage, memory, session, skills, catalog, lang, artifacts, citations, state, history = []) {
    const llm = getLlm();
    const prior = artifacts.priorEvidenceForSupervisor();
    const hist = history
        .slice(-6)
        .map((h) => `${h.role}: ${String(h.content || "").slice(0, 400)}`)
        .join("\n");
    const messages = [
        { role: "system", content: supervisorSystemPrompt(skills, memory) },
        {
            role: "user",
            content: `This turn: ${userMessage}\n\nRecent dialogue:\n${hist || "(none)"}\n\nPrior database results:\n${prior}\n\nAlready tried: ${outcomesSummary(state.outcomes)}\ngap_score=${gapScore(state.outcomes).toFixed(2)} (advisory — do not force breadth/depth). Begin supervision.`,
        },
    ];
    let finished = false;
    for (let round = 0; round < cfg.drSupervisorMaxRounds && !finished; round++) {
        yield setPhase(session, AgentPhase.supervising, "Evaluating evidence, choosing next step");
        const tools = await buildSupervisorTools(state);
        const { content, toolCalls, reasoning } = await llm.chatCompletion(messages, {
            tools,
            maxTokens: 1200,
            temperature: 0.25,
        });
        const rationale = stripProtocolMarkup(reasoning || content || "").text.trim();
        yield {
            type: "supervisor_decision",
            round,
            actions: toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments || {} })),
            rationale,
            gap_score: gapScore(state.outcomes),
            outcomes_summary: outcomesSummary(state.outcomes),
        };
        const detail = stripProtocolMarkup(content || "").text.trim();
        if (detail) {
            yield {
                type: "phase_update",
                phase: AgentPhase.supervising,
                label: "Evaluating evidence, choosing next step",
                detail,
            };
        }
        if (!toolCalls.length) {
            if (content?.toLowerCase().includes("finish"))
                finished = true;
            break;
        }
        const wantsFinish = toolCalls.some((tc) => tc.name === "finish_research");
        const actionable = toolCalls.filter((tc) => tc.name !== "finish_research");
        if (wantsFinish && !actionable.length) {
            finished = true;
            break;
        }
        messages.push({
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
            })),
        });
        const toolResultById = new Map();
        for (const tc of actionable) {
            if (tc.name === "breadth_search") {
                yield {
                    type: "tool_call",
                    tool_name: "breadth_search",
                    arguments: tc.arguments || {},
                    kind: "database",
                };
                yield* runBreadthPlanExecute(userMessage, memory, session, skills, catalog, lang, artifacts, citations, state);
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
                yield* runDepthSearch(userMessage, memory, session, lang, artifacts, citations, state, focus, query);
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
                    if (web && !isWebSearchFailure(web)) {
                        artifacts.add("web_search", q, web.slice(0, 1500));
                        state.toolsUsed.push("web_search");
                    }
                    toolResultById.set(tc.id, `web_search: ${web.slice(0, 200)}`);
                }
                else {
                    toolResultById.set(tc.id, "web_search skipped — empty query");
                }
                continue;
            }
            if (mayRecallIntent(tc.name, state.emptyTools, state.succeededTools, { expand: wantsIntentExpand(tc.arguments) })) {
                yield {
                    type: "tool_call",
                    tool_name: tc.name,
                    arguments: tc.arguments || {},
                    kind: "database",
                };
                const { tool, result, outcome } = await executeIntent(tc.name, memory, userMessage, tc.arguments);
                yield* commitIntentResult(tool, result, outcome, memory, artifacts, citations, state);
                toolResultById.set(tc.id, `[${tool}] ${outcome.summary}`);
            }
            else {
                toolResultById.set(tc.id, `[${tc.name}] skipped — already empty or succeeded (pass a higher limit or sources to expand truncated rows)`);
            }
        }
        const gap = gapScore(state.outcomes);
        const canFinish = shouldAcceptFinish(state, artifacts);
        for (const tc of toolCalls) {
            if (tc.name === "finish_research") {
                toolResultById.set(tc.id, canFinish
                    ? `finish_research accepted — proceeding to synthesis (gap=${gap.toFixed(2)} advisory)`
                    : `finish_research noted (gap=${gap.toFixed(2)})`);
            }
        }
        if (wantsFinish) {
            yield {
                type: "supervisor_decision",
                round,
                actions: [{ name: "finish_research" }],
                finish_accepted: canFinish,
                gap_score: gap,
                outcomes_summary: outcomesSummary(state.outcomes),
            };
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
            content: `gap_score=${gap.toFixed(2)} (advisory)\n${outcomesSummary(state.outcomes)}\nContinue for this turn's question, or finish_research.`,
        });
    }
}
