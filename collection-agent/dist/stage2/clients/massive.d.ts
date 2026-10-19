import { type AccessionHit } from "../accessions.js";
/** Primary MassIVE accession for a PROXI dataset row (MS:1002487). */
export declare function primaryMassiveAccession(row: unknown): string | null;
/**
 * Resolve a known MSV accession. PROXI keyword search may return unrelated
 * rows — only keep a hit when the row's primary id equals the query.
 */
export declare function lookupMassiveByAccession(msvId: string): Promise<AccessionHit[]>;
export declare function searchMassiveByDoi(doi: string): Promise<AccessionHit[]>;
