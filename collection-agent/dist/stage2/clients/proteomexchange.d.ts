import { type AccessionHit } from "../accessions.js";
/**
 * Fetch ProteomeXchange Central JSON for a known accession (PXD/MSV/…).
 * Used to harvest cross-repository mirrors (e.g. PXD ↔ MSV).
 */
export declare function fetchPxDataset(accession: string): Promise<AccessionHit[]>;
/** Expand a set of accessions via PX Central cross-links */
export declare function expandViaProteomeXchange(ids: string[]): Promise<AccessionHit[]>;
