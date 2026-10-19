import type { MsRepoKind } from "../types.js";
/** Split Stage3 Identifier field into individual accessions. */
export declare function splitIdentifiers(identifier: string): string[];
export declare function repoFromAccession(id: string): MsRepoKind;
/** Prefer accession prefix; fall back to msDataSource hints. */
export declare function resolveRepo(id: string, msDataSource: string): MsRepoKind;
/** Pick a PXD from the same paper to fetch ProteomeXchange XML for iProX datasets. */
export declare function pickPxdForIprox(ids: string[]): string | undefined;
