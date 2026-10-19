import type { AccessionHit } from "../accessions.js";
/** PRIDE search by DOI (pubmed keyword search is unreliable). */
export declare function searchPrideByDoi(doi: string): Promise<AccessionHit[]>;
export declare function searchPrideByKeyword(keyword: string, via: string): Promise<AccessionHit[]>;
