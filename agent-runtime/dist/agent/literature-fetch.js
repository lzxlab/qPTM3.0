import { cfg } from "../config.js";
import { callQptmTool } from "../mcp/hub.js";
import { extractPmids, mergeLiteratureResults, papersFromToolResult, papersNeedAbstracts, } from "./literature.js";
function pmidCap(args) {
    const limit = Number(args.limit);
    const fromLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : cfg.litAbstractLimit;
    return Math.max(1, Math.min(cfg.litAbstractLimit, fromLimit, 20));
}
/**
 * One ReAct search_literature call: query search + top abstracts when the model
 * did not already pass pmids / fulltext_pmids.
 */
export async function callSearchLiteratureDeep(args) {
    const hasPmids = Boolean(String(args.pmids || "").trim());
    const hasFulltext = Boolean(String(args.fulltext_pmids || "").trim());
    const first = await callQptmTool("search_literature", args);
    if (hasPmids || hasFulltext)
        return first;
    const papers = papersFromToolResult(first);
    if (!papersNeedAbstracts(papers))
        return first;
    let pmids = papers.map((p) => p.pmid).filter(Boolean);
    if (!pmids.length) {
        pmids = extractPmids(`${first.summary || ""}\n${JSON.stringify(first.blocks || first.data || {})}`, pmidCap(args));
    }
    pmids = [...new Set(pmids)].slice(0, pmidCap(args));
    if (!pmids.length)
        return first;
    const abstracts = await callQptmTool("search_literature", {
        ...args,
        pmids: pmids.join(","),
        max_chars: cfg.litAbstractMaxChars,
    });
    if (!abstracts.success && !papersFromToolResult(abstracts).length) {
        return {
            ...first,
            summary: `${first.summary || ""} | abstracts unavailable`.slice(0, 800),
        };
    }
    return mergeLiteratureResults(first, abstracts);
}
