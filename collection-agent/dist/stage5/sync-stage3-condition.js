/**
 * Sync Stage3 literature_info.Condition from Stage5 qratio conditions.
 *
 * Used only by the opt-in script `sync-stage3-from-qratio.ts`.
 * Stage5 pipeline no longer mutates Stage3 automatically; see `conditionRefined`
 * on Stage5Result / parse_report.csv instead.
 *
 * Stage3 Meta often emits coarse comparisons (e.g. "MI/Sham"); Stage5 reads the
 * actual ratio columns (e.g. "MI_30/SHAM; MI_6h/SHAM; MI_6h/MI_30"). The sync
 * script prefers the table-derived Condition list only when it is biologically
 * informative and not worse than existing Stage3 metadata.
 */
import { writeFileSync } from "node:fs";
import { loadStage3Results, rebuildStage3Outputs, stage3ResultsJsonlPath, } from "../utils/io.js";
import { biologicalConditionOverlap, hasExtraSpecificity, informativeStage3Parts, isChannelLabel, isCrypticCondition, isGenericRatioLabel, isTechnicalRatioLabel, } from "./condition.js";
function isInformativeDerivedCondition(c) {
    const t = (c || "").trim();
    if (!t)
        return false;
    if (isChannelLabel(t) || isGenericRatioLabel(t) || isTechnicalRatioLabel(t))
        return false;
    if (isCrypticCondition(t))
        return false;
    if (/\b(phosphorylation|acetylation|ubiquitylation|glycosylation|methylation|sumoylation|adp-ribosylation|palmitoylation|myristoylation)\b/i.test(t))
        return false;
    return true;
}
/** Unique informative conditions in stable lexicographic order. */
export function collectConditionsFromQratioRows(rows) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        const c = (r.condition || "").trim();
        if (!isInformativeDerivedCondition(c))
            continue;
        const key = c.toLowerCase().replace(/\s+/g, "");
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(c);
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}
/** SILAC: keep Stage3 treatment/Ctr contrasts; table labels (WT_10min) stay on qratio rows only. */
function shouldSkipStage3Sync(existing, derived) {
    if (derived.length === 0)
        return true;
    if (!/silac/i.test(existing.labelMethod || ""))
        return false;
    const parts = informativeStage3Parts(existing.condition || "");
    if (parts.length === 0)
        return false;
    return parts.some((p) => /\//.test(p));
}
/**
 * Decide whether Stage5-derived conditions should replace Stage3 Condition.
 * Never overwrite informative Stage3 biology with technical sheet headers (mod/base).
 */
export function evaluateStage3ConditionSync(existing, derived) {
    const informativeDerived = collectConditionsFromQratioRows(derived.map((condition) => ({ condition })));
    const after = informativeDerived.join("; ");
    if (informativeDerived.length === 0) {
        return { shouldSync: false, reason: "derived_technical_or_generic", informativeDerived, after };
    }
    if (shouldSkipStage3Sync(existing, informativeDerived)) {
        return { shouldSync: false, reason: "silac_keep_stage3", informativeDerived, after };
    }
    const existingParts = informativeStage3Parts(existing.condition || "");
    const before = (existing.condition || "").trim();
    if (existingParts.length === 0) {
        return { shouldSync: true, reason: "stage3_empty_or_cryptic", informativeDerived, after };
    }
    if (before === after) {
        return { shouldSync: false, reason: "unchanged", informativeDerived, after };
    }
    let hasOverlap = false;
    let hasImprovement = false;
    for (const d of informativeDerived) {
        for (const p of existingParts) {
            if (biologicalConditionOverlap(d, p) >= 1.5)
                hasOverlap = true;
            if (hasExtraSpecificity(d, p))
                hasImprovement = true;
        }
    }
    if (informativeDerived.length > existingParts.length && (hasOverlap || hasImprovement)) {
        return { shouldSync: true, reason: "derived_more_contrasts", informativeDerived, after };
    }
    if (hasImprovement) {
        return { shouldSync: true, reason: "derived_more_specific", informativeDerived, after };
    }
    if (!hasOverlap) {
        return { shouldSync: false, reason: "keep_informative_stage3", informativeDerived, after };
    }
    // Overlap but not clearly better — keep Stage3 authority
    return { shouldSync: false, reason: "keep_informative_stage3", informativeDerived, after };
}
function mergeNotes(existing, addition) {
    const a = (existing || "").trim();
    const b = addition.trim();
    if (!b)
        return a;
    if (!a)
        return b;
    if (a.includes(b))
        return a;
    // Drop prior sync notes to avoid unbounded growth
    const cleaned = a
        .split(/\s*\|\s*/)
        .filter((p) => !/^condition synced from Stage5/i.test(p.trim()))
        .join(" | ");
    return cleaned ? `${cleaned} | ${b}` : b;
}
/**
 * Replace Stage3 Condition for one PMID with Stage5-derived list.
 * Leaves Detail condition unchanged (narrative context).
 */
export function syncStage3ConditionFromQratio(pmid, rows) {
    const derived = collectConditionsFromQratioRows(rows);
    const all = loadStage3Results();
    const idx = all.findIndex((r) => r.pmid === pmid);
    if (idx < 0) {
        return {
            pmid,
            updated: false,
            before: "",
            after: derived.join("; "),
            reason: "stage3_row_missing",
        };
    }
    const before = all[idx].condition || "";
    const decision = evaluateStage3ConditionSync(all[idx], derived);
    if (!decision.shouldSync) {
        return { pmid, updated: false, before, after: decision.after, reason: decision.reason };
    }
    const note = `condition synced from Stage5 (was: ${before || "empty"})`;
    const next = {
        ...all[idx],
        condition: decision.after,
        notes: mergeNotes(all[idx].notes || "", note),
    };
    all[idx] = next;
    writeFileSync(stage3ResultsJsonlPath(), all.map((r) => JSON.stringify(r)).join("\n") + (all.length ? "\n" : ""), "utf8");
    rebuildStage3Outputs();
    return { pmid, updated: true, before, after: decision.after, reason: decision.reason };
}
/** Backfill: rebuild Stage3 Condition from existing qratio_rows.jsonl for ok PMIDs. */
export function syncAllStage3ConditionsFromQratioRows(allRows, okPmids) {
    const byPmid = new Map();
    for (const r of allRows) {
        if (okPmids && !okPmids.has(r.pmid))
            continue;
        const list = byPmid.get(r.pmid) ?? [];
        list.push(r);
        byPmid.set(r.pmid, list);
    }
    const out = [];
    // Batch: mutate once then rebuild
    const all = loadStage3Results();
    const byIdx = new Map(all.map((r, i) => [r.pmid, i]));
    let dirty = false;
    for (const [pmid, rows] of byPmid) {
        const derived = collectConditionsFromQratioRows(rows);
        const idx = byIdx.get(pmid);
        if (idx == null) {
            out.push({
                pmid,
                updated: false,
                before: "",
                after: derived.join("; "),
                reason: "stage3_row_missing",
            });
            continue;
        }
        const before = all[idx].condition || "";
        const decision = evaluateStage3ConditionSync(all[idx], derived);
        if (!decision.shouldSync) {
            out.push({ pmid, updated: false, before, after: decision.after, reason: decision.reason });
            continue;
        }
        const note = `condition synced from Stage5 (was: ${before || "empty"})`;
        all[idx] = {
            ...all[idx],
            condition: decision.after,
            notes: mergeNotes(all[idx].notes || "", note),
        };
        dirty = true;
        out.push({ pmid, updated: true, before, after: decision.after, reason: decision.reason });
    }
    if (dirty) {
        writeFileSync(stage3ResultsJsonlPath(), all.map((r) => JSON.stringify(r)).join("\n") + (all.length ? "\n" : ""), "utf8");
        rebuildStage3Outputs();
    }
    return out;
}
