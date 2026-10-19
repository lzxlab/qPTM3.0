/** Proteome repository accession patterns */
const PATTERNS = [
    { re: /\bPXD\d{5,}\b/gi, source: "PRIDE" },
    { re: /\bIPX\d{6,}\b/gi, source: "iProX" },
    { re: /\bJPST\d{5,}\b/gi, source: "jPOST" },
    { re: /\bMSV\d{9}\b/gi, source: "MassIVE" },
    { re: /\bPDC\d{6}\b/gi, source: "PDC" },
];
/** True when the paper text says data live in iProX (often with PXD partner IDs). */
export function textMentionsIprox(text) {
    return /\biprox\b/i.test(text || "");
}
/**
 * PXD IDs deposited via the iProX ProteomeXchange partner are not PRIDE FTP datasets.
 * Keep the PXD string but retag source so Stage-3/6 do not treat them as EBI PRIDE.
 */
export function retagPxdForIproxPartner(hits, excerpt) {
    if (!textMentionsIprox(excerpt))
        return hits;
    return hits.map((h) => {
        if (!/^PXD\d+$/i.test(h.id))
            return h;
        if (h.source === "iProX" || h.source === "ProteomeXchange")
            return h;
        return {
            ...h,
            source: "ProteomeXchange",
            via: h.via.includes("iprox-partner") ? h.via : `${h.via};iprox-partner`,
        };
    });
}
export function extractAccessions(text, via) {
    if (!text)
        return [];
    const seen = new Set();
    const out = [];
    for (const { re, source } of PATTERNS) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
            const id = m[0].toUpperCase();
            if (seen.has(id))
                continue;
            seen.add(id);
            out.push({ id, source, via });
        }
    }
    return retagPxdForIproxPartner(out, text);
}
export function mergeAccessions(...lists) {
    const byId = new Map();
    for (const list of lists) {
        for (const hit of list) {
            const prev = byId.get(hit.id);
            if (!prev)
                byId.set(hit.id, hit);
            else {
                // Prefer a more specific / non-PRIDE source when merging mirrors
                let source = prev.source;
                if (prev.source === "PRIDE" && hit.source !== "PRIDE" && hit.source !== "unknown") {
                    source = hit.source;
                }
                else if (hit.source === "PRIDE" && prev.source !== "PRIDE" && prev.source !== "unknown") {
                    source = prev.source;
                }
                else if (hit.source && hit.source !== "unknown") {
                    source = prev.source || hit.source;
                }
                const via = prev.via.includes(hit.via) || !hit.via
                    ? prev.via
                    : prev.via
                        ? `${prev.via};${hit.via}`
                        : hit.via;
                byId.set(hit.id, { ...prev, source, via });
            }
        }
    }
    return [...byId.values()];
}
export function sourceFromId(id) {
    const u = id.toUpperCase();
    if (u.startsWith("PXD"))
        return "PRIDE";
    if (u.startsWith("IPX"))
        return "iProX";
    if (u.startsWith("JPST"))
        return "jPOST";
    if (u.startsWith("MSV"))
        return "MassIVE";
    if (u.startsWith("PDC"))
        return "PDC";
    return "unknown";
}
const SOURCE_PRIORITY = {
    iProX: 0,
    jPOST: 1,
    PDC: 2,
    MassIVE: 3,
    ProteomeXchange: 4,
    PRIDE: 5,
    unknown: 6,
};
/** Stable order for KnownIdentifiers: native repo IDs (IPX…) before PXD mirrors. */
export function sortAccessionsForMeta(hits) {
    return [...hits].sort((a, b) => {
        const sa = SOURCE_PRIORITY[a.source] ?? 9;
        const sb = SOURCE_PRIORITY[b.source] ?? 9;
        if (sa !== sb)
            return sa - sb;
        // Prefer native prefixes over PXD when source ties
        const nativeA = /^IPX|^JPST|^MSV|^PDC/i.test(a.id) ? 0 : 1;
        const nativeB = /^IPX|^JPST|^MSV|^PDC/i.test(b.id) ? 0 : 1;
        if (nativeA !== nativeB)
            return nativeA - nativeB;
        return a.id.localeCompare(b.id);
    });
}
/**
 * Pick identifiers to feed Stage-3 meta extraction.
 *
 * MassIVE PROXI keyword lookup historically dumped ~100 unrelated MSV ids into
 * Stage-2 manifests. Prefer accessions that actually appear in the paper
 * excerpt; if the Stage-2 list looks like that pollution and the text has no
 * IDs, drop the MassIVE bulk rather than poisoning Identifier.
 *
 * Critical: iProX deposits often list ProteomeXchange PXD partner IDs in the
 * Data Availability statement while Stage-2 already resolved the native IPX.
 * Never replace Stage-2 IPX/jPOST/… with excerpt-only PXD labeled as PRIDE.
 */
export function selectKnownIdentifiersForMeta(repos, excerpt) {
    const normalized = (repos || [])
        .map((r) => ({
        id: (r.id || "").toUpperCase().trim(),
        source: r.source || sourceFromId(r.id || ""),
        via: r.via || "stage2",
    }))
        .filter((r) => r.id);
    const massive = normalized.filter((r) => r.source === "MassIVE");
    const other = normalized.filter((r) => r.source !== "MassIVE");
    // Heuristic: PROXI keyword dumps are large and almost entirely MassIVE
    const stage2Trusted = massive.length > 5 && massive.length >= normalized.length - 1 ? other : normalized;
    const inExcerpt = extractAccessions(excerpt || "", "excerpt");
    if (inExcerpt.length === 0) {
        return sortAccessionsForMeta(mergeAccessions(stage2Trusted));
    }
    const repoById = new Map(stage2Trusted.map((r) => [r.id, r]));
    const overlap = inExcerpt
        .map((h) => repoById.get(h.id))
        .filter((h) => Boolean(h));
    const stage2Native = stage2Trusted.filter((r) => /^(iProX|jPOST|PDC|MassIVE)$/i.test(r.source) || /^IPX|^JPST|^MSV|^PDC/i.test(r.id));
    const excerptOnlyPxd = inExcerpt.every((h) => /^PXD/i.test(h.id));
    // Stage-2 already has native iProX/IPX (etc.): keep them and merge any text IDs.
    // Do not let "PXD… via iProX partner" wipe out IPX and become PRIDE-only.
    if (stage2Native.length > 0) {
        return sortAccessionsForMeta(mergeAccessions(stage2Native, inExcerpt, overlap));
    }
    if (overlap.length > 0) {
        return sortAccessionsForMeta(mergeAccessions(overlap, inExcerpt));
    }
    // Text-only PXD while paper names iProX → retag already applied in extractAccessions
    if (excerptOnlyPxd && textMentionsIprox(excerpt)) {
        return sortAccessionsForMeta(inExcerpt);
    }
    return sortAccessionsForMeta(mergeAccessions(stage2Trusted, inExcerpt));
}
/** Prefer native repository name when KnownIdentifiers / text disagree with LLM. */
export function preferMsDataSource(llmSource, known, excerpt = "") {
    const llm = (llmSource || "").trim();
    const sources = [...new Set(known.map((h) => h.source).filter(Boolean))];
    const hasIprox = sources.includes("iProX") ||
        known.some((h) => /^IPX/i.test(h.id)) ||
        textMentionsIprox(excerpt);
    const hasPrideOnly = sources.length > 0 && sources.every((s) => s === "PRIDE" || s === "ProteomeXchange");
    if (hasIprox) {
        // Native IPX accessions → iProX; partner PXD + iProX mention → iProX
        if (known.some((h) => /^IPX/i.test(h.id) || h.source === "iProX"))
            return "iProX";
        if (textMentionsIprox(excerpt))
            return "iProX";
    }
    if (sources.length === 1 && sources[0] !== "ProteomeXchange")
        return sources[0];
    if (sources.length === 1 && sources[0] === "ProteomeXchange" && textMentionsIprox(excerpt)) {
        return "iProX";
    }
    if (llm && !/^pride$/i.test(llm))
        return llm;
    if (hasPrideOnly && !textMentionsIprox(excerpt))
        return "PRIDE";
    if (llm)
        return llm;
    return sources.filter((s) => s !== "ProteomeXchange").join("; ") || sources.join("; ") || "";
}
