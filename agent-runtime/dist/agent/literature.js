const PMID_LABELED = /PMID[:\s]*(\d{7,8})/gi;
export function extractPmids(text, max = 10) {
    const seen = new Set();
    const out = [];
    const add = (id) => {
        if (!id || seen.has(id) || out.length >= max)
            return;
        seen.add(id);
        out.push(id);
    };
    const src = String(text || "");
    for (const m of src.matchAll(PMID_LABELED))
        add(m[1]);
    if (out.length < max) {
        for (const m of src.matchAll(/"pmid"\s*:\s*"?(\d{7,8})"?/gi))
            add(m[1]);
    }
    return out;
}
function rowPmid(row) {
    const raw = String(row.pmid || row.PMID || "").trim();
    return /^\d{7,8}$/.test(raw) ? raw : "";
}
export function papersFromToolResult(result) {
    const out = [];
    const seen = new Set();
    const blocks = result?.blocks;
    if (Array.isArray(blocks)) {
        for (const block of blocks) {
            const rows = block.rows;
            if (!Array.isArray(rows))
                continue;
            for (const raw of rows) {
                if (!raw || typeof raw !== "object")
                    continue;
                const row = raw;
                const pmid = rowPmid(row);
                if (!pmid || seen.has(pmid))
                    continue;
                seen.add(pmid);
                out.push({
                    pmid,
                    title: String(row.title || ""),
                    abstract: String(row.abstract || ""),
                    fulltext: row.fulltext ? String(row.fulltext) : undefined,
                });
            }
        }
    }
    if (!out.length && result?.summary) {
        for (const pmid of extractPmids(result.summary, 20)) {
            out.push({ pmid, title: "", abstract: "" });
        }
    }
    return out;
}
export function papersNeedAbstracts(papers) {
    if (!papers.length)
        return true;
    return !papers.some((p) => Boolean(p.abstract && p.abstract.trim()));
}
export function mergeLiteratureResults(search, abstracts) {
    const blocks = [...(Array.isArray(search.blocks) ? search.blocks : []), ...(Array.isArray(abstracts.blocks) ? abstracts.blocks : [])];
    const papers = papersFromToolResult(abstracts);
    const absCount = papers.filter((p) => p.abstract?.trim()).length;
    const summary = [search.summary, abstracts.summary, absCount ? `Fetched ${absCount} abstract(s)` : ""]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 800);
    const ok = Boolean(search.success || abstracts.success);
    return {
        success: ok,
        summary,
        data: abstracts.data ?? search.data,
        blocks,
        intent: "search_literature",
        error_kind: ok ? null : abstracts.error_kind || search.error_kind || "empty_result",
        missing: abstracts.missing?.length ? abstracts.missing : search.missing,
        resolved: abstracts.resolved || search.resolved,
    };
}
