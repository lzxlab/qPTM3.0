import { extractAccessions, mergeAccessions } from "./accessions.js";
import { fetchEuropePmcFullTextXml, fetchEuropePmcMeta } from "./clients/europepmc.js";
import { searchPrideByDoi } from "./clients/pride.js";
import { expandViaProteomeXchange } from "./clients/proteomexchange.js";
import { lookupMassiveByAccession, searchMassiveByDoi } from "./clients/massive.js";
import { lookupIprox, lookupJpost } from "./clients/iprox-jpost.js";
import { fetchDoiLandingAccessions } from "./clients/doi-html.js";
function uniqueChannels(hits) {
    return [...new Set(hits.flatMap((h) => h.via.split(";")))].sort();
}
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
function resolveStatus(hits, stepErrors) {
    if (hits.length > 0)
        return stepErrors.length > 0 ? "partial" : "found";
    if (stepErrors.length > 0)
        return "error";
    return "not_found";
}
async function safeMerge(hits, stepErrors, label, fn) {
    try {
        return mergeAccessions(hits, await fn());
    }
    catch (err) {
        stepErrors.push(`${label}: ${errMsg(err)}`);
        return hits;
    }
}
/** Run many independent probes and merge every successful result. */
async function safeMergeAll(stepErrors, probes) {
    const results = await Promise.all(probes.map(async ({ label, fn }) => {
        try {
            return { ok: true, hits: await fn() };
        }
        catch (err) {
            return { ok: false, label, err: errMsg(err) };
        }
    }));
    let merged = [];
    for (const r of results) {
        if (r.ok)
            merged = mergeAccessions(merged, r.hits);
        else
            stepErrors.push(`${r.label}: ${r.err}`);
    }
    return merged;
}
/**
 * Cascaded Stage-2 discovery (no PDF by default):
 * 1) abstract / stage1 reason regex
 * 2) repo reverse lookup (PRIDE by DOI, MassIVE, PX expand, iProX/jPOST validate)
 * 3) Europe PMC full text XML / DOI HTML
 * 4) mark needsPdf if still empty
 *
 * Independent network steps run concurrently to cut wall-clock latency.
 * Each network step is isolated — partial hits from earlier steps are never discarded.
 */
export async function discoverForPmid(input) {
    const discoveredAt = new Date().toISOString();
    const base = {
        pmid: input.pmid,
        title: input.title,
        dataSourceHint: input.dataSourceHint,
        discoveredAt,
    };
    const stepErrors = [];
    // --- 1) abstract / reason (local regex; no network) ---
    let hits = mergeAccessions(extractAccessions(input.abstract ?? "", "abstract"), extractAccessions(input.stage1Reason ?? "", "stage1_reason"), extractAccessions(input.title ?? "", "title"));
    // --- Europe PMC meta (DOI / PMCID) ---
    let doi = null;
    let pmcid = null;
    let isOpenAccess = false;
    try {
        const meta = await fetchEuropePmcMeta(input.pmid);
        doi = meta.doi;
        pmcid = meta.pmcid;
        isOpenAccess = meta.isOpenAccess;
    }
    catch (err) {
        stepErrors.push(`europepmc_meta: ${errMsg(err)}`);
    }
    // --- 2) repository reverse lookup + Europe PMC full text, in parallel ---
    // These are independent once DOI/PMCID are known: PRIDE-by-DOI, MassIVE-by-DOI
    // and the Europe PMC full-text XML scan can all run at once.
    hits = await safeMergeAll(stepErrors, [
        { label: "pride_doi", fn: () => (doi ? searchPrideByDoi(doi) : Promise.resolve([])) },
        { label: "massive_doi", fn: () => (doi ? searchMassiveByDoi(doi) : Promise.resolve([])) },
        {
            label: "europepmc_xml",
            fn: () => pmcid
                ? fetchEuropePmcFullTextXml(pmcid).then((xml) => xml ? extractAccessions(xml, "europepmc:xml") : [])
                : Promise.resolve([]),
        },
    ]);
    const expandable = hits.map((h) => h.id).filter((id) => /^(PXD|MSV|PDC)/i.test(id));
    if (expandable.length) {
        hits = await safeMerge(hits, stepErrors, "proteomexchange", () => expandViaProteomeXchange(expandable));
    }
    // --- 3) validate / expand per-hit repo lookups, in parallel ---
    const perHit = [...hits]
        .map((h) => {
        if (h.source === "iProX")
            return { label: `iprox:${h.id}`, fn: () => lookupIprox(h.id) };
        if (h.source === "jPOST")
            return { label: `jpost:${h.id}`, fn: () => lookupJpost(h.id) };
        if (h.source === "MassIVE")
            return { label: `massive:${h.id}`, fn: () => lookupMassiveByAccession(h.id) };
        return null;
    })
        .filter((p) => p !== null);
    if (perHit.length) {
        hits = await safeMergeAll(stepErrors, perHit);
    }
    // --- 4) DOI HTML fallback (only when nothing found yet) ---
    if (hits.length === 0 && doi) {
        hits = await safeMerge(hits, stepErrors, "doi_html", () => fetchDoiLandingAccessions(doi));
        const more = hits.map((h) => h.id).filter((id) => /^(PXD|MSV|PDC)/i.test(id));
        if (more.length) {
            hits = await safeMerge(hits, stepErrors, "proteomexchange_doi", () => expandViaProteomeXchange(more));
        }
    }
    const channelsHit = uniqueChannels(hits);
    const needsPdf = hits.length === 0;
    const status = resolveStatus(hits, stepErrors);
    const notes = hits.length
        ? `Found ${hits.length} accession(s) via ${channelsHit.join(", ")}${stepErrors.length ? ` (${stepErrors.length} step warning(s))` : ""}`
        : stepErrors.length
            ? "Discover failed on all network steps; consider PDF / manual queue"
            : "No repository accession found; consider PDF / manual queue";
    return {
        ...base,
        status,
        doi,
        pmcid,
        isOpenAccess,
        repositories: hits,
        channelsHit,
        needsPdf,
        notes,
        ...(stepErrors.length ? { error: stepErrors.join("; ") } : {}),
    };
}
