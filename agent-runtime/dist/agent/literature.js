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
export function geneLikeTokens(text, exclude = [], max = 8) {
    const skip = new Set(["DNA", "RNA", "PTM", "PMID", "PMC", "OA", "THE", "AND", "FOR", "WITH", "FROM", "CELL", "HUMAN", "SITE"].concat(exclude.map((e) => e.toUpperCase())));
    const seen = new Set();
    const out = [];
    for (const m of String(text || "").matchAll(/\b([A-Z][A-Z0-9]{1,7})\b/g)) {
        const tok = m[1];
        if (skip.has(tok) || seen.has(tok))
            continue;
        seen.add(tok);
        out.push(tok);
        if (out.length >= max)
            break;
    }
    return out;
}
export function normalizeLitQuery(q) {
    return String(q || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}
export function entitiesMissingFromQuery(query, entities) {
    const q = normalizeLitQuery(query);
    const seen = new Set();
    const out = [];
    for (const raw of entities) {
        const e = String(raw || "").trim();
        if (!e || e.length < 2)
            continue;
        const key = e.toLowerCase();
        if (seen.has(key) || q.includes(key))
            continue;
        seen.add(key);
        out.push(e);
    }
    return out;
}
export function withFrontierEntities(query, entities, max = 3) {
    const add = entitiesMissingFromQuery(query, entities).slice(0, max);
    const base = String(query || "").trim();
    if (!add.length)
        return base;
    return `${base} ${add.join(" ")}`.trim();
}
export function literatureTokens(memory, focus = "", question = "") {
    const raw = [
        memory.gene || "",
        memory.position ? String(memory.position) : "",
        memory.position ? `s${memory.position}` : "",
        memory.ptm_type,
        focus,
        question,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const toks = raw.match(/[a-z0-9]{2,}/g) || [];
    return [...new Set(toks)];
}
export function rankLiteraturePapers(papers, tokens, gene) {
    const geneTok = (gene || "").toLowerCase();
    const scored = papers.map((p) => {
        const blob = `${p.title} ${p.abstract}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
            if (t.length < 2)
                continue;
            if (blob.includes(t))
                score += t === geneTok ? 3 : 1;
        }
        return { ...p, score };
    });
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    const min = geneTok ? 2 : 1;
    return scored.filter((p) => (p.score || 0) >= min);
}
