import { type AccessionHit } from "../accessions.js";
/**
 * Fetch DOI landing page HTML (publisher) and regex-extract repository IDs.
 * Best-effort; many publishers block bots — failures are non-fatal.
 */
export declare function fetchDoiLandingAccessions(doi: string): Promise<AccessionHit[]>;
