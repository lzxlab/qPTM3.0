const MAX_ROWS_PER_BLOCK = 200;
const MAX_ROW_FIELDS = 12;
const MAX_FIELD_CHARS = 120;
const MAX_ARRAY_ITEMS = 4;
const PRIORITY_FIELD_RE = /^(log2|qratio|fold_change|fc|p[_-]?value|pvalue|pval|fdr|qvalue|score|rho|event_count|n_events|condition_name|condition|kinase|drug|pmid|in_vivo|in_vitro|evidence)/i;
function clipScalar(v) {
    if (typeof v === "string")
        return v.slice(0, MAX_FIELD_CHARS);
    if (typeof v === "number" || typeof v === "boolean")
        return v;
    return String(v).slice(0, MAX_FIELD_CHARS);
}
function flattenNested(prefix, value, out) {
    if (value == null || value === "")
        return;
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => (item != null && typeof item === "object" ? JSON.stringify(item) : String(item)))
            .filter((s) => s && s !== "[]" && s !== "{}");
        if (items.length)
            out[prefix] = items.join("; ").slice(0, MAX_FIELD_CHARS);
        return;
    }
    if (typeof value !== "object") {
        out[prefix] = clipScalar(value);
        return;
    }
    for (const [k, v] of Object.entries(value)) {
        if (v == null || v === "")
            continue;
        const key = `${prefix}_${k}`;
        if (v != null && typeof v === "object") {
            if (Array.isArray(v))
                flattenNested(key, v, out);
            else if (Object.keys(v).length && Object.values(v).every((x) => x == null || typeof x !== "object")) {
                flattenNested(key, v, out);
            }
            continue;
        }
        out[key] = clipScalar(v);
    }
}
/** Lift nested dicts (log2_range.avg → log2_avg) so quantitative fields survive compaction. */
export function flattenRow(row) {
    const flat = {};
    for (const [k, v] of Object.entries(row)) {
        if (v == null || v === "")
            continue;
        if (v != null && typeof v === "object") {
            flattenNested(k.replace(/_range$/i, ""), v, flat);
            continue;
        }
        flat[k] = clipScalar(v);
    }
    return flat;
}
function fieldPriority(key) {
    const k = key.toLowerCase();
    if (PRIORITY_FIELD_RE.test(k) || k.includes("log2") || k.endsWith("_avg"))
        return 0;
    return 1;
}
export function compactRow(row) {
    const flat = flattenRow(row);
    const keys = Object.keys(flat).sort((a, b) => fieldPriority(a) - fieldPriority(b) || a.localeCompare(b));
    const out = {};
    for (const key of keys) {
        if (Object.keys(out).length >= MAX_ROW_FIELDS)
            break;
        out[key] = flat[key];
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
}
