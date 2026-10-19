import { type AccessionHit } from "../accessions.js";
/** iProX: no stable public PMID search; validate known IPX via project page HTML. */
export declare function lookupIprox(ipxId: string): Promise<AccessionHit[]>;
/** jPOST: validate known JPST via repository page. */
export declare function lookupJpost(jpstId: string): Promise<AccessionHit[]>;
