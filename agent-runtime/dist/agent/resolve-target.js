import { mergeEntities, sameGene } from "../context/memory.js";
import { callQptmTool } from "../mcp/hub.js";
function isResidueToken(token) {
    return /^[STYKR]\d{2,5}$/i.test(token.trim());
}
export function applyResolvedIdentity(memory, result) {
    const blob = result.resolved && typeof result.resolved === "object"
        ? result.resolved
        : result.data && typeof result.data === "object"
            ? result.data
            : null;
    if (!blob)
        return;
    const gene = blob.gene != null ? String(blob.gene).trim() : "";
    const uniprot = blob.uniprot_ac != null ? String(blob.uniprot_ac).trim().toUpperCase() : "";
    const positionRaw = blob.position;
    const position = typeof positionRaw === "number"
        ? positionRaw
        : positionRaw != null && String(positionRaw).trim()
            ? Number(positionRaw)
            : NaN;
    const ptm = blob.ptm_type != null ? String(blob.ptm_type) : "";
    // Never let a tool result overwrite the query gene with a different protein
    // (e.g. uniprot_annotation(P04637) returning TP53 after the user asked STAT3).
    if (gene && memory.gene && !isResidueToken(memory.gene) && !sameGene(memory.gene, gene)) {
        return;
    }
    const patch = {};
    if (gene && !isResidueToken(gene)) {
        if (!memory.gene || isResidueToken(memory.gene) || uniprot) {
            patch.gene = gene;
        }
    }
    if (uniprot)
        patch.uniprot_ac = uniprot;
    if (Number.isFinite(position) && position > 0)
        patch.position = position;
    if (ptm)
        patch.ptm_type = ptm;
    mergeEntities(memory, patch);
}
/** Resolve gene/site → UniProt on every user turn (no stale-session short-circuit). */
export async function resolveSessionTarget(memory, query) {
    const result = await callQptmTool("resolve_ptm_target", {
        query,
        gene: memory.gene && !isResidueToken(memory.gene) ? memory.gene : "",
        position: memory.position || 0,
        uniprot_ac: memory.uniprot_ac || "",
        ptm_type: memory.ptm_type || "",
    });
    if (result.success) {
        applyResolvedIdentity(memory, result);
    }
    else if (memory.gene) {
        // Failed resolve must not keep a previous accession from another protein.
        memory.uniprot_ac = null;
    }
    return result;
}
export function invokeArgumentsJson(memory, query, extra = {}) {
    return JSON.stringify({
        gene: memory.gene && !isResidueToken(memory.gene) ? memory.gene : "",
        position: memory.position || 0,
        uniprot_ac: memory.uniprot_ac || "",
        ptm_type: memory.ptm_type || "phosphorylation",
        query,
        ...(extra.entity ? { entity: extra.entity } : {}),
    });
}
export function resolvedBanner(memory, lang) {
    if (!memory.gene && !memory.uniprot_ac)
        return "";
    const gene = memory.gene || "";
    const ac = memory.uniprot_ac || "";
    const site = memory.position ? String(memory.position) : "";
    const org = memory.organism || "human";
    const core = [gene, ac ? `(${ac})` : "", site ? `· ${site}` : "", org ? `· ${org}` : ""]
        .filter(Boolean)
        .join(" ");
    return lang === "zh"
        ? `**已解析靶点：** Resolved: ${core}\n\n`
        : `**Resolved:** ${core}\n\n`;
}
