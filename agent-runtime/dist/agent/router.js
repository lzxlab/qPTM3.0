import { shouldSkipInvestigation } from "./gate.js";
export function isSpecificEnough(memory) {
    return Boolean((memory.gene || memory.uniprot_ac) && memory.position);
}
/** Pure routing — no I/O. Mirrors run.ts investigation vs direct-answer split. */
export function routeQuery(input) {
    const specificEnough = isSpecificEnough(input.memory);
    const skippedClarify = Boolean(input.skippedClarify);
    if (!input.clarificationResponse && shouldSkipInvestigation(input.queryMode)) {
        return { handler: "qa_direct", mayClarify: false, specificEnough };
    }
    const mayClarify = !skippedClarify && !specificEnough && input.clarifyRound < input.maxClarifyRounds;
    if (mayClarify) {
        return { handler: "clarify", mayClarify: true, specificEnough };
    }
    return { handler: "investigate", mayClarify: false, specificEnough };
}
