import { cfg } from "../config.js";
import { memoryPromptBlock } from "../context/memory.js";
import { getLlm } from "../llm/client.js";
import { ANSWER_LANGUAGE_RULE } from "./gate.js";
import { toolDatabase } from "./citations.js";
import { ThoughtFlusher } from "./thought-flush.js";
import { loadSkills, skillsForMode } from "../skills/loader.js";
const CLUE_MAX = 5500;
const ROWS_PER_BLOCK = 6;
const LIT_CLUES = 6;
function compactRowLine(row) {
    return Object.entries(row)
        .filter(([, v]) => v != null && v !== "")
        .slice(0, 5)
        .map(([k, v]) => `${k}=${v}`)
        .join(" | ");
}
function looksLikeToolId(s) {
    return /^[a-z][a-z0-9_]*$/.test(s);
}
function sourceLabel(tool, source) {
    const fromTool = tool ? toolDatabase(tool) : "";
    const src = (source || "").trim();
    if (src && !looksLikeToolId(src))
        return src;
    if (fromTool && !looksLikeToolId(fromTool))
        return fromTool;
    return "database";
}
/** Compact clues for the answer writer — not an inventory to copy. */
export function cluesForComposer(memory, artifacts, maxChars = CLUE_MAX) {
    const parts = [
        `Target: ${memoryPromptBlock(memory)}`,
        "These are clues to support an answer. Do not reproduce this inventory. Pick only what backs a claim.",
    ];
    for (const a of artifacts.findDbResults()) {
        if (/\[empty_result\]/i.test(a.summary))
            continue;
        const blocks = a.payload?.blocks || [];
        if (!blocks.length)
            continue;
        for (const b of blocks) {
            if (!b.rows.length && !b.shown)
                continue;
            const label = sourceLabel(a.tool, b.source);
            const level = b.evidence_level ? `, ${b.evidence_level}` : "";
            parts.push(`### ${label}${level} (${b.shown}/${b.total || b.shown})`);
            for (const row of b.rows.slice(0, ROWS_PER_BLOCK)) {
                const line = compactRowLine(row);
                if (line)
                    parts.push(`- ${line}`);
            }
        }
    }
    const papers = artifacts.findLiterature().filter((a) => a.kind === "paper");
    const searches = artifacts.findLiterature().filter((a) => a.kind === "literature_search");
    const lit = (papers.length ? papers : searches).slice(0, LIT_CLUES);
    if (lit.length) {
        parts.push("### Literature clues");
        for (const a of lit) {
            const pmid = a.pmids?.[0] ? `PMID:${a.pmids[0]} ` : "";
            parts.push(`- ${pmid}${a.summary.replace(/\s+/g, " ").slice(0, 280)}`);
        }
    }
    const webs = artifacts.findWebSearch().slice(0, 2);
    if (webs.length) {
        parts.push("### Web snippets");
        for (const a of webs) {
            const bit = a.summary.replace(/\s+/g, " ").slice(0, 220);
            if (bit)
                parts.push(`- ${bit}`);
        }
    }
    const body = parts.join("\n");
    return body.length > maxChars ? `${body.slice(0, maxChars - 1)}…` : body;
}
export function composeSystemPrompt(citeList) {
    return `You are the qPTM post-translational modification research assistant. Answer the user's scientific question. You are not writing a retrieval report or a database dump.

How to write:
1. Understand the question first. Build the answer skeleton from the question (what they actually asked), not from which databases were queried.
2. Lead with the conclusion in your own words, then develop only the sub-questions the user asked.
3. Clues are muscle: cite a fact, a compact markdown table, or a PMID only where it supports a claim. A table must follow one sentence stating what the table is arguing.
4. Do not inventory searches, empty databases, or unused dimensions. No "executive summary", "evidence collected this round", "limitations & gaps", or evidence-priority slogans (database > literature > web).
5. Name sources as products people know (qPTM, PhosphoSitePlus, PubMed, Europe PMC). Never write MCP or internal tool names (search_ptm_sites, get_upstream_enzymes, web_search, resolve_ptm_target, etc.).
6. Predicted scores (GPS, PhosLLPS, dSCOPE) are not experiments — mention predicted only when that claim relies on them.
7. Mention a gap only in one closing sentence, and only if it changes the conclusion.
8. Length follows the question: a single-site kinase question stays short even if clues are many; a multi-part survey can be longer because the question has more parts.
Never emit protocol markup or tool-call XML.
${ANSWER_LANGUAGE_RULE}
Available citation labels (optional inline): ${citeList || "(none)"}`;
}
function composeMessages(question, history, memory, artifacts, citations, skills) {
    const citeList = citations.map((c) => `${c.id}: ${c.database}`).join(", ");
    const clues = cluesForComposer(memory, artifacts);
    return [
        { role: "system", content: `${composeSystemPrompt(citeList)}\n\n${skills}`.trim() },
        ...history.slice(-6).map((h) => ({
            role: h.role,
            content: h.content,
        })),
        {
            role: "user",
            content: `Question: ${question}\n\nClues:\n${clues}`,
        },
    ];
}
export async function* composeAnswer(question, history, memory, artifacts, citations) {
    const skills = loadSkills(skillsForMode("compose", question));
    const messages = composeMessages(question, history, memory, artifacts, citations, skills);
    const llm = getLlm();
    let gotText = false;
    const thoughts = new ThoughtFlusher();
    for await (const ev of llm.chatCompletionStream(messages, {
        maxTokens: Math.min(cfg.drSynthesisMaxTokens, 8192),
        temperature: 0.35,
        maxModels: cfg.drSynthesisMaxModels,
        timeoutMs: cfg.drSynthesisTimeoutMs,
        totalTimeoutMs: cfg.drSynthesisTimeoutMs,
    })) {
        if (ev.type === "reasoning" && ev.content) {
            const flushed = thoughts.push(ev.content);
            if (flushed)
                yield { kind: "reasoning", content: flushed };
            continue;
        }
        if (ev.type !== "text" || !ev.content)
            continue;
        gotText = true;
        yield { kind: "text", content: ev.content };
    }
    const rest = thoughts.flush();
    if (rest)
        yield { kind: "reasoning", content: rest };
    if (!gotText)
        throw new Error("empty compose stream");
}
