import { getLlm } from "../llm/client.js";
import { detectLang } from "./gate.js";
/** Reject assistant-to-user clarification / meta prompts — chips must be user-askable. */
function looksLikeAgentAskingUser(text) {
    return /^(您|你|请问|能否|可否|是否希望|您是否|你是否|您提到|你提到|请确认|请补充)/.test(text)
        || /您是否希望|你是否希望|是指.+吗|我(将|可以)基于|重新查询|若确认/.test(text)
        || /^(Would you|Do you|Can you|Could you|Shall I|Should I|Did you mean|Are you asking)/i.test(text)
        || /\b(would you like me|do you want me|shall I|did you mean)\b/i.test(text);
}
/** Concept / refuse / greeting — chips that land on concrete PTM site questions. */
export function ptmSteerFollowUps(lang) {
    if (lang === "zh") {
        return [
            { text: "哪些激酶磷酸化 AKT1 S473？", intent: "qa" },
            { text: "TP53 S15 在 DNA 损伤后如何被磷酸化？", intent: "qa" },
            { text: "EGFR Y1068 磷酸化与哪些药物有关？", intent: "qa" },
            { text: "STAT3 Y705 在癌症信号中如何被调控？", intent: "qa" },
            { text: "MDM2 S166 乙酰化受哪些条件影响？", intent: "qa" },
        ];
    }
    return [
        { text: "Which kinases phosphorylate AKT1 S473?", intent: "qa" },
        { text: "How is TP53 S15 phosphorylated after DNA damage?", intent: "qa" },
        { text: "What drugs affect EGFR Y1068 phosphorylation?", intent: "qa" },
        { text: "How is STAT3 Y705 regulated in cancer signaling?", intent: "qa" },
        { text: "Which conditions regulate MDM2 S166 acetylation?", intent: "qa" },
    ];
}
export async function generateFollowUps(question, answer, memory, artifacts, mode, toolsUsed) {
    const lang = detectLang(question);
    if (memory.query_mode === "concept")
        return ptmSteerFollowUps(lang);
    const artifactCatalog = artifacts.catalogForPrompt(8);
    const toolsLine = toolsUsed.length ? toolsUsed.join(", ") : "none";
    const drRule = mode === "qa"
        ? lang === "zh"
            ? "其中 2-3 条 intent 必须为 deep_research，用于引导用户做深度调研。"
            : "Include 2-3 items with intent deep_research to guide deeper investigation."
        : lang === "zh"
            ? "全部 intent 为 qa（用户已在深度调研模式）。"
            : "All intent must be qa (user is already in deep research).";
    const prompt = lang === "zh"
        ? `根据本轮调研生成 5 个「用户可一键发送」的后续问题。
硬性要求：
1. text 必须是用户口吻的科学追问（例如「TP53 S15 有哪些上游激酶？」），点一下就会作为新问题发出。
2. 禁止助手反问用户（禁止「您提到的…是指…吗？」「您是否希望我重新查询…」等确认/征求许可句式）。
3. 禁止讨论系统/工具元问题（靶点解析错误、MCP 未连接、是否重跑某工具）。
4. 结合实际用过的数据库与结论往深处问，不要泛泛而谈。
${drRule}
输出 JSON: [{"text":"...","intent":"qa"|"deep_research"}]

调查上下文: gene=${memory.gene || ""} site=${memory.position || ""} UniProt=${memory.uniprot_ac || ""}
已用工具: ${toolsLine}
Artifacts: ${artifactCatalog}

用户问题: ${question}
回答摘要: ${(answer || "").slice(0, 2500)}`
        : `Generate 5 clickable follow-up questions the USER would send next.
Hard rules:
1. Phrased as the user's scientific questions (e.g. "Which kinases phosphorylate TP53 S15?").
2. Never ask the user for confirmation or permission ("Did you mean…?", "Would you like me to…?").
3. No meta/system topics (parse errors, reconnect tools, re-run queries).
4. Ground in databases/findings from this turn — no generic templates.
${drRule}
Output JSON: [{"text":"...","intent":"qa"|"deep_research"}]

Context: gene=${memory.gene || ""} site=${memory.position || ""} UniProt=${memory.uniprot_ac || ""}
Tools used: ${toolsLine}
Artifacts: ${artifactCatalog}

Question: ${question}
Answer excerpt: ${(answer || "").slice(0, 2500)}`;
    try {
        const llm = getLlm();
        const { content } = await llm.chatCompletion([{ role: "user", content: prompt }], {
            maxTokens: 800,
            temperature: 0.4,
        });
        const parsed = parseFollowUpJson(content).filter((q) => !looksLikeAgentAskingUser(q.text));
        if (parsed.length >= 3)
            return normalizeFollowUps(parsed, mode, lang, memory);
    }
    catch {
        /* fallback below */
    }
    return fallbackFollowUps(mode, lang, memory);
}
function parseFollowUpJson(raw) {
    let text = raw.trim();
    if (text.startsWith("```")) {
        text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    try {
        const data = JSON.parse(text);
        const arr = Array.isArray(data) ? data : [];
        return arr
            .map((item) => {
            if (typeof item === "string")
                return { text: item, intent: "qa" };
            if (item && typeof item === "object" && "text" in item) {
                const t = String(item.text);
                const intent = item.intent === "deep_research" ? "deep_research" : "qa";
                return { text: t, intent };
            }
            return null;
        })
            .filter((x) => x !== null && x.text.length >= 8);
    }
    catch {
        return [];
    }
}
function normalizeFollowUps(items, mode, lang, memory) {
    let out = items.filter((q) => !looksLikeAgentAskingUser(q.text)).slice(0, 5);
    if (mode === "qa") {
        const drCount = out.filter((q) => q.intent === "deep_research").length;
        if (drCount < 2) {
            const extras = fallbackFollowUps("qa", lang, memory).filter((q) => q.intent === "deep_research");
            for (const e of extras) {
                if (out.length >= 5)
                    break;
                if (!out.some((x) => x.text === e.text))
                    out.push(e);
            }
        }
    }
    while (out.length < 5) {
        const fb = fallbackFollowUps(mode, lang, memory);
        for (const f of fb) {
            if (!out.some((x) => x.text === f.text) && !looksLikeAgentAskingUser(f.text))
                out.push(f);
            if (out.length >= 5)
                break;
        }
        break;
    }
    return out.slice(0, 5);
}
function fallbackFollowUps(mode, lang, memory) {
    const site = memory.gene && memory.position ? `${memory.gene} ${memory.position}` : "TP53 S15";
    if (lang === "zh") {
        const qa = [
            { text: `${site} 在哪些实验条件下被修饰？`, intent: "qa" },
            { text: `哪些激酶可能磷酸化 ${site}？`, intent: "qa" },
            { text: `对 ${site} 做全面调研（激酶、定量、功能疾病）`, intent: "deep_research" },
            { text: `${site} 与疾病或药物调控有何关联？`, intent: "qa" },
            { text: "哪些激酶磷酸化 AKT1 S473？", intent: "qa" },
        ];
        return qa;
    }
    const qa = [
        { text: `Under which conditions is ${site} modified?`, intent: "qa" },
        { text: `Which kinases may phosphorylate ${site}?`, intent: "qa" },
        { text: `Investigate ${site} (kinases, quantitation, function/disease)`, intent: "deep_research" },
        { text: `What disease or drug links exist for ${site}?`, intent: "qa" },
        { text: "Which kinases phosphorylate AKT1 S473?", intent: "qa" },
    ];
    return qa;
}
