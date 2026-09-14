const MAX_ROWS_PER_BLOCK = 200;
const MAX_ROW_FIELDS = 8;
const MAX_FIELD_CHARS = 120;
function compactRow(row) {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(row)) {
        if (v == null || v === "")
            continue;
        if (typeof v === "object")
            continue;
        if (n >= MAX_ROW_FIELDS)
            break;
        out[k] = typeof v === "string" ? v.slice(0, MAX_FIELD_CHARS) : v;
        n += 1;
    }
    return out;
}
/** Compact MCP intent blocks so sessions can list last-query hits. */
export function compactDbPayload(result) {
    const blocks = Array.isArray(result.blocks) ? result.blocks : [];
    if (!blocks.length)
        return undefined;
    return {
        intent: result.intent,
        blocks: blocks.map((raw) => {
            const b = (raw || {});
            const rowsIn = Array.isArray(b.rows)
                ? b.rows.filter((r) => Boolean(r) && typeof r === "object")
                : [];
            const shown = Number(b.shown);
            const total = Number(b.total);
            const rowCount = rowsIn.length;
            const shownN = Number.isFinite(shown) && shown >= 0 ? shown : rowCount;
            const totalN = Number.isFinite(total) && total >= 0 ? total : Math.max(shownN, rowCount);
            return {
                tool: b.tool ? String(b.tool) : undefined,
                source: String(b.source_name || b.tool || ""),
                evidence_level: b.evidence_level ? String(b.evidence_level) : undefined,
                total: totalN,
                shown: shownN,
                truncated: Boolean(b.truncated) || totalN > shownN,
                rows: rowsIn.slice(0, MAX_ROWS_PER_BLOCK).map(compactRow),
            };
        }),
    };
}
function blockRowCount(block) {
    return block.shown || block.rows.length || 0;
}
export class ArtifactStore {
    artifacts = [];
    counter = 0;
    add(kind, query, summary, extra = {}) {
        this.counter += 1;
        const artifact = {
            id: `a${this.counter}`,
            kind,
            query,
            summary: summary.slice(0, 2000),
            createdAt: new Date().toISOString(),
            ...extra,
        };
        this.artifacts.push(artifact);
        return artifact;
    }
    list() {
        return [...this.artifacts];
    }
    get(id) {
        return this.artifacts.find((a) => a.id === id);
    }
    findLiterature() {
        return this.artifacts.filter((a) => a.kind === "literature_search" || a.kind === "paper");
    }
    findDbResults() {
        return this.artifacts.filter((a) => a.kind === "db_result");
    }
    findWebSearch() {
        return this.artifacts.filter((a) => a.kind === "web_search");
    }
    /** Kinase / gene-like names from compact DB rows for BFS→DFS frontier. */
    frontierEntities(max = 12, exclude = []) {
        const skip = new Set(exclude.map((e) => e.toLowerCase()).filter(Boolean));
        const seen = new Set();
        const names = [];
        for (const a of this.findDbResults()) {
            for (const b of a.payload?.blocks || []) {
                for (const r of b.rows) {
                    const n = String(r.kinase_gene || r.kinase || r.KINASE || r.gene || r.name || "").trim();
                    const key = n.toLowerCase();
                    if (!n || n.length < 2 || n.length > 14 || skip.has(key) || seen.has(key))
                        continue;
                    seen.add(key);
                    names.push(n);
                    if (names.length >= max)
                        return names;
                }
            }
        }
        return names;
    }
    hasLiteratureQuery(q) {
        const n = q
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
        if (!n)
            return false;
        return this.findLiterature().some((a) => a.query
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim() === n);
    }
    catalogForPrompt(max = 20, opts = {}) {
        let items = this.artifacts.slice(-max);
        if (opts.skipEmpty) {
            items = items.filter((a) => !/\[empty_result\]/i.test(a.summary));
        }
        if (!items.length)
            return "(no artifacts yet)";
        return items
            .map((a) => {
            const payload = a.payload;
            const counts = payload?.blocks?.length
                ? payload.blocks
                    .map((b) => {
                    const tag = b.truncated ? `truncated ${b.shown}/${b.total}` : `${b.shown}/${b.total}`;
                    return `${b.source || b.tool || "src"} ${tag}`;
                })
                    .join("; ")
                : "";
            const extra = counts ? ` [${counts}]` : a.pmids?.length ? ` (PMIDs: ${a.pmids.slice(0, 5).join(",")})` : "";
            return `[${a.id}] ${a.kind}: ${a.query.slice(0, 120)} → ${a.summary.slice(0, 200)}${extra}`;
        })
            .join("\n");
    }
    /** Full compact rows for listing / synthesis — not the 200-char catalog. */
    rowsForPrompt(maxChars = 12000) {
        const dbs = this.findDbResults().filter((a) => a.payload?.blocks?.length);
        if (!dbs.length)
            return "";
        const parts = [];
        for (const a of dbs) {
            const intent = a.payload?.intent || a.tool || a.query;
            parts.push(`### ${intent}`);
            for (const b of a.payload?.blocks || []) {
                const flag = b.truncated ? ` truncated, showing ${b.shown} of ${b.total}` : ` ${b.shown} of ${b.total}`;
                parts.push(`- ${b.source || b.tool || "source"} (${b.evidence_level || "unknown"}${flag})`);
                for (const row of b.rows) {
                    const cells = Object.entries(row)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(" | ");
                    if (cells)
                        parts.push(`  - ${cells}`);
                }
            }
        }
        return parts.join("\n").slice(0, maxChars);
    }
    /** Compact briefing for the supervisor (counts + preview names). */
    priorEvidenceForSupervisor(maxChars = 4000) {
        const dbs = this.findDbResults();
        if (!dbs.length)
            return "(no prior database results)";
        const lines = [];
        for (const a of dbs) {
            const tool = a.tool || a.query;
            const blocks = a.payload?.blocks || [];
            if (!blocks.length) {
                lines.push(`[${tool}] ${a.summary.slice(0, 240)}`);
                continue;
            }
            for (const b of blocks) {
                const names = b.rows
                    .map((r) => String(r.kinase_gene || r.kinase || r.KINASE || r.gene || r.name || "").trim())
                    .filter(Boolean)
                    .slice(0, 12);
                const more = b.truncated ? `; truncated ${b.shown}/${b.total} — re-call with higher limit or sources to expand` : "";
                const preview = names.length ? `; e.g. ${names.join(", ")}` : "";
                lines.push(`[${tool}/${b.source || b.tool || "src"}] ${b.shown}/${b.total} rows${preview}${more}`);
            }
        }
        return lines.join("\n").slice(0, maxChars);
    }
    dbRowCount(tool) {
        return this.findDbResults()
            .filter((a) => !tool || a.tool === tool || a.query === tool)
            .reduce((sum, a) => sum + (a.payload?.blocks || []).reduce((s, b) => s + blockRowCount(b), 0), 0);
    }
    load(list) {
        this.artifacts = Array.isArray(list) ? list.map((a) => ({ ...a })) : [];
        this.counter = this.artifacts.reduce((max, a) => {
            const n = Number(String(a.id || "").replace(/^a/i, ""));
            return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);
    }
    toJSON() {
        return this.list();
    }
    clear() {
        this.artifacts = [];
        this.counter = 0;
    }
    shouldSkipLiteratureSearch(message) {
        const refers = /这些文献|上述文献|刚才的文献|those papers|these papers|the papers above|summarize.*literature|文献讲了|上面.*文献/i.test(message);
        if (!refers)
            return false;
        return this.findLiterature().length > 0;
    }
    getLiteratureContext() {
        const lit = this.findLiterature();
        if (!lit.length)
            return "";
        return lit
            .map((a) => `${a.query}\n${a.summary}`)
            .join("\n---\n")
            .slice(0, 18000);
    }
    /** Secondary web snippets for DR synthesis — smaller budget than DB/literature. */
    getWebSearchContext(maxChars = 2500) {
        const web = this.findWebSearch();
        if (!web.length)
            return "";
        const body = web
            .map((a) => `Query: ${a.query}\n${a.summary}`)
            .join("\n---\n");
        return `### Web search (secondary, low weight)\n${body}`.slice(0, maxChars);
    }
}
