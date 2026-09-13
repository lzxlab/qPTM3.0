/** MCP intent tools exposed via tools/list (not registry tool names). */
export const MCP_INTENT_TOOLS = [
    "resolve_ptm_target",
    "search_ptm_sites",
    "get_site_conditions",
    "get_upstream_enzymes",
    "get_function_disease",
    "get_llps",
    "get_drug_ptm",
    "get_localization",
    "get_ppi_pathways",
    "search_literature",
];
const INTENT_HINTS = {
    kinase: "get_upstream_enzymes",
    condition: "get_site_conditions",
    localization: "get_localization",
    function: "get_function_disease",
    disease: "get_function_disease",
    drug: "get_drug_ptm",
    ppi: "get_ppi_pathways",
    llps: "get_llps",
    literature: "search_literature",
    site: "search_ptm_sites",
};
const KEYWORDS = {
    kinase: /\b(kinase|激酶|磷酸化|phosphorylat|upstream|enzyme|e3|writer|eraser)\b/i,
    condition: /\b(condition|fold|log2|定量|条件|倍数|treatment|dynamics|when)\b/i,
    localization: /\b(locali|定位|compartment|domain|结构域|nls|nes|where)\b/i,
    function: /\b(function|功能|mechanism|机制|role|stability|稳定|why|意义)\b/i,
    disease: /\b(disease|cancer|疾病|肿瘤|mutation|突变)\b/i,
    drug: /\b(drug|药物|inhibitor|therapy|抑制剂)\b/i,
    ppi: /\b(ppi|interact|互作|binding partner|pathway|通路)\b/i,
    llps: /\b(llps|phase separation|相分离|condensate)\b/i,
    literature: /\b(literature|paper|pubmed|文献|论文)\b/i,
};
function scoreIntents(question, memory) {
    const scores = {};
    for (const [dim, re] of Object.entries(KEYWORDS)) {
        if (re.test(question))
            scores[dim] = (scores[dim] || 0) + 2;
    }
    if (memory.position)
        scores.kinase = (scores.kinase || 0) + 1;
    if (memory.gene && !memory.position)
        scores.condition = (scores.condition || 0) + 1;
    if (!Object.keys(scores).length)
        scores.site = 1;
    return scores;
}
/** Rank MCP intent tools for a research question (replaces legacy registry tool names). */
export function retrieveIntentTools(question, memory, topK = 4) {
    const scores = scoreIntents(question, memory);
    const picked = ["search_ptm_sites"];
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    for (const [dim] of ranked) {
        const tool = INTENT_HINTS[dim];
        if (tool && !picked.includes(tool))
            picked.push(tool);
    }
    if (memory.position && !picked.includes("get_upstream_enzymes")) {
        picked.push("get_upstream_enzymes");
    }
    if (memory.position && /condition|fold|定量|when|treatment/i.test(question)) {
        if (!picked.includes("get_site_conditions"))
            picked.push("get_site_conditions");
    }
    if (picked.length < 2) {
        picked.push("get_upstream_enzymes");
    }
    return [...new Set(picked)].slice(0, topK);
}
export function retrieveIntentToolsDeep(question, memory) {
    const base = retrieveIntentTools(question, memory, 6);
    const all = new Set(base);
    if (/local|domain|where|定位/i.test(question))
        all.add("get_localization");
    if (/drug|药|inhibitor/i.test(question))
        all.add("get_drug_ptm");
    if (/llps|相分离|phase/i.test(question))
        all.add("get_llps");
    if (/literature|文献|paper/i.test(question))
        all.add("search_literature");
    if (/disease|癌|突变|function|功能/i.test(question))
        all.add("get_function_disease");
    if (/ppi|pathway|互作|通路/i.test(question))
        all.add("get_ppi_pathways");
    return [...all].slice(0, 6);
}
/** @deprecated Use retrieveIntentTools */
export function retrieveTools(question, memory, topK = 6) {
    return retrieveIntentTools(question, memory, topK);
}
/** @deprecated Use retrieveIntentToolsDeep */
export function retrieveToolsDeep(question, memory) {
    return retrieveIntentToolsDeep(question, memory);
}
