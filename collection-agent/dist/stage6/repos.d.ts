/** Discover PRIDE FTP directory URL (HTTPS) for a PXD accession. */
export declare function fetchPrideFtpDirUrl(pxd: string): Promise<string>;
export declare function downloadPrideListingHtml(pxd: string, outPath: string): Promise<string>;
/** Download ProteomeXchange XML (works for PXD via PX Central). */
export declare function downloadPxXml(accession: string, outPath: string): Promise<void>;
/**
 * Download iProX ProteomeXchange XML for IPX.
 * Primary: http://download.iprox.org/{IPX}/PX_{IPX}.xml (public, per iProX helpApi convention).
 * Fallback: PX Central when a PXD accession is known for the same paper.
 */
export declare function downloadIproxXml(ipx: string, outPath: string, opts?: {
    pxd?: string;
}): Promise<{
    sourceUrl: string;
    pxd?: string;
}>;
export declare function downloadJpostPageHtml(jpst: string, outPath: string): Promise<string>;
/** Fallback when FTP file list is empty: use publicationDate from PRIDE API. */
export declare function pridePublicationDate(pxd: string): Promise<string | undefined>;
