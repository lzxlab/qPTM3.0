import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchIproxPxXml, parsePxdFromPxXml, } from "./iprox-api.js";
import { fetchJson, fetchText } from "../stage2/http.js";
const PRIDE_FTP_HTTPS = "https://ftp.pride.ebi.ac.uk";
/** Discover PRIDE FTP directory URL (HTTPS) for a PXD accession. */
export async function fetchPrideFtpDirUrl(pxd) {
    const filesUrl = `https://www.ebi.ac.uk/pride/ws/archive/v2/projects/${encodeURIComponent(pxd)}/files` +
        `?pageSize=1&page=0`;
    const files = await fetchJson(filesUrl, { timeoutMs: 30_000 });
    const ftp = files[0]?.publicFileLocations?.find((l) => (l.name ?? "").toLowerCase().includes("ftp"));
    if (!ftp?.value)
        throw new Error(`No FTP location for ${pxd}`);
    const m = ftp.value.match(/^ftp:\/\/[^/]+(\/.+\/)[^/]+$/);
    if (!m)
        throw new Error(`Cannot parse FTP directory from: ${ftp.value}`);
    return `${PRIDE_FTP_HTTPS}${m[1]}`;
}
export async function downloadPrideListingHtml(pxd, outPath) {
    const dirUrl = await fetchPrideFtpDirUrl(pxd);
    const html = await fetchText(dirUrl, { timeoutMs: 60_000 });
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, html, "utf8");
    return dirUrl;
}
/** Download ProteomeXchange XML (works for PXD via PX Central). */
export async function downloadPxXml(accession, outPath) {
    const url = `https://proteomecentral.proteomexchange.org/cgi/GetDataset` +
        `?ID=${encodeURIComponent(accession)}&outputMode=XML&test=no`;
    const xml = await fetchText(url, { timeoutMs: 60_000, accept: "application/xml,text/xml,*/*" });
    if (!xml.includes("<ProteomeXchangeDataset")) {
        throw new Error(`Not a ProteomeXchange XML response for ${accession}`);
    }
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, xml, "utf8");
}
/**
 * Download iProX ProteomeXchange XML for IPX.
 * Primary: http://download.iprox.org/{IPX}/PX_{IPX}.xml (public, per iProX helpApi convention).
 * Fallback: PX Central when a PXD accession is known for the same paper.
 */
export async function downloadIproxXml(ipx, outPath, opts = {}) {
    mkdirSync(join(outPath, ".."), { recursive: true });
    try {
        const { xml, url } = await fetchIproxPxXml(ipx);
        writeFileSync(outPath, xml, "utf8");
        const pxd = parsePxdFromPxXml(xml);
        return { sourceUrl: url, pxd };
    }
    catch (iproxErr) {
        if (opts.pxd) {
            await downloadPxXml(opts.pxd, outPath);
            return { sourceUrl: `proteomecentral:${opts.pxd}`, pxd: opts.pxd.toUpperCase() };
        }
        throw iproxErr;
    }
}
export async function downloadJpostPageHtml(jpst, outPath) {
    const url = `https://repository.jpostdb.org/entry/${encodeURIComponent(jpst)}`;
    const html = await fetchText(url, { timeoutMs: 30_000 });
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, html, "utf8");
    return url;
}
/** Fallback when FTP file list is empty: use publicationDate from PRIDE API. */
export async function pridePublicationDate(pxd) {
    try {
        const data = await fetchJson(`https://www.ebi.ac.uk/pride/ws/archive/v2/projects/${encodeURIComponent(pxd)}`, { timeoutMs: 20_000 });
        return data.publicationDate;
    }
    catch {
        return undefined;
    }
}
