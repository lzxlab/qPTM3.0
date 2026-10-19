import { formatSilacBiologyLabel, silacBiologySuffixFromHeader } from "./condition.js";
const CONTROL_GENOTYPE = /^(wt|ctrl|control|con|ctr|wild[\s-]?type|sham|vehicle)$/i;
const TREATMENT_HINT = /(ko|kd|knockout|mut|mutant|del|deletion|sirna|shrna|oe|overexpress)/i;
/** Parse MaxQuant-style sample suffix "WT_10min" / "ARH3ko_120min". */
export function parseSilacSampleArm(suffix) {
    const raw = (suffix || "").trim();
    if (!raw)
        return null;
    const m = raw.match(/^(.+?)_(\d+(?:\.\d+)?\s*(?:min|mins|minute|minutes|h|hr|hrs|hour|hours))$/i);
    if (!m)
        return null;
    const genotype = m[1].trim();
    const time = m[2].replace(/\s+/g, " ").trim();
    if (!genotype || !time)
        return null;
    return { raw, genotype, time };
}
function isControlGenotype(genotype) {
    return CONTROL_GENOTYPE.test(genotype.trim());
}
function isTreatmentGenotype(genotype) {
    return TREATMENT_HINT.test(genotype);
}
function stage3ContrastLabel(treatGenotype, refGenotype, time) {
    const base = `${treatGenotype}/${refGenotype}`;
    return time ? `${base} (${time})` : base;
}
/**
 * Pair SILAC ratio columns that share a time suffix into genotype contrasts (treat/ref).
 * Skips when only channel-level H/L labels exist without paired genotypes.
 */
export function buildSilacGenotypeContrasts(ratioColumns) {
    const arms = [];
    for (const col of ratioColumns) {
        const suffix = silacBiologySuffixFromHeader(col.column);
        if (!suffix)
            continue;
        const arm = parseSilacSampleArm(suffix);
        if (!arm)
            continue;
        arms.push({ arm, col });
    }
    if (arms.length < 2)
        return [];
    const byTime = new Map();
    for (const item of arms) {
        const key = item.arm.time.toLowerCase().replace(/\s+/g, "");
        const list = byTime.get(key) ?? [];
        list.push(item);
        byTime.set(key, list);
    }
    const out = [];
    for (const [, group] of byTime) {
        if (group.length < 2)
            continue;
        const controls = group.filter((g) => isControlGenotype(g.arm.genotype));
        const treats = group.filter((g) => isTreatmentGenotype(g.arm.genotype));
        if (controls.length !== 1 || treats.length !== 1)
            continue;
        const ref = controls[0];
        const treat = treats[0];
        out.push({
            condition: stage3ContrastLabel(treat.arm.genotype, ref.arm.genotype, ref.arm.time),
            treat: treat.col,
            ref: ref.col,
        });
    }
    return out.sort((a, b) => a.condition.localeCompare(b.condition, undefined, { numeric: true }));
}
/** log2( treat_H/L / ref_H/L ) for linear MaxQuant SILAC ratios. */
export function silacGenotypeLog2Fc(treatRaw, refRaw, treatIsLog2, refIsLog2) {
    const treatLinear = treatIsLog2 ? 2 ** treatRaw : treatRaw;
    const refLinear = refIsLog2 ? 2 ** refRaw : refRaw;
    if (!(treatLinear > 0) || !(refLinear > 0))
        return null;
    return Math.log2(treatLinear / refLinear);
}
export function silacContrastFromColumn(col) {
    const suffix = silacBiologySuffixFromHeader(col.column);
    return suffix ? formatSilacBiologyLabel(suffix) : col.condition;
}
