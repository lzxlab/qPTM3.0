import { type AccessionHit } from "./accessions.js";
export type DiscoverStatus = "found" | "partial" | "not_found" | "error";
export interface Stage2DiscoverInput {
    pmid: string;
    title: string;
    abstract: string;
    stage1Reason?: string;
    dataSourceHint?: string;
}
export interface Stage2Manifest {
    pmid: string;
    title: string;
    status: DiscoverStatus;
    doi: string | null;
    pmcid: string | null;
    isOpenAccess: boolean;
    repositories: AccessionHit[];
    channelsHit: string[];
    needsPdf: boolean;
    notes: string;
    discoveredAt: string;
    dataSourceHint?: string;
    error?: string;
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
export declare function discoverForPmid(input: Stage2DiscoverInput): Promise<Stage2Manifest>;
