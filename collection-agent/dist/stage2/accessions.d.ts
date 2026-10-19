/** Proteome repository accession patterns */
export type RepoSource = "PRIDE" | "iProX" | "jPOST" | "MassIVE" | "PDC" | "ProteomeXchange" | "unknown";
export interface AccessionHit {
    id: string;
    source: RepoSource;
    via: string;
}
/** True when the paper text says data live in iProX (often with PXD partner IDs). */
export declare function textMentionsIprox(text: string): boolean;
/**
 * PXD IDs deposited via the iProX ProteomeXchange partner are not PRIDE FTP datasets.
 * Keep the PXD string but retag source so Stage-3/6 do not treat them as EBI PRIDE.
 */
export declare function retagPxdForIproxPartner(hits: AccessionHit[], excerpt: string): AccessionHit[];
export declare function extractAccessions(text: string, via: string): AccessionHit[];
export declare function mergeAccessions(...lists: AccessionHit[][]): AccessionHit[];
export declare function sourceFromId(id: string): RepoSource;
/** Stable order for KnownIdentifiers: native repo IDs (IPX…) before PXD mirrors. */
export declare function sortAccessionsForMeta(hits: AccessionHit[]): AccessionHit[];
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
export declare function selectKnownIdentifiersForMeta(repos: Array<{
    id: string;
    source: string;
    via?: string;
}>, excerpt: string): AccessionHit[];
/** Prefer native repository name when KnownIdentifiers / text disagree with LLM. */
export declare function preferMsDataSource(llmSource: string, known: AccessionHit[], excerpt?: string): string;
