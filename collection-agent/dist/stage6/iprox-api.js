/**
 * iProX public web APIs — https://www.iprox.cn/page/helpApi.html
 *
 * Documented JSONP endpoints (no login required):
 *   projectFileList/getProjectDataFileByProjectId.jsonp
 *   projectFileList/getProjectDataFileByDay|Month|Year.jsonp
 *
 * ProteomeXchange XML for an IPX project (public HTTP):
 *   http://download.iprox.org/{IPX}/PX_{IPX}.xml
 *
 * Bulk download via Aspera (account required):
 *   username@download.iprox.org:/data/iprox/{IPX}
 */
import { fetchJson, fetchText } from "../stage2/http.js";
const IPROX_BASE = "https://www.iprox.cn";
const IPROX_DOWNLOAD_HTTP = "http://download.iprox.org";
const IPROX_DOWNLOAD_HTTP_CN = "http://download.iprox.cn";
export function iproxPxXmlUrl(ipx, mirror = "org") {
    const id = ipx.toUpperCase();
    const host = mirror === "cn" ? IPROX_DOWNLOAD_HTTP_CN : IPROX_DOWNLOAD_HTTP;
    return `${host}/${id}/PX_${id}.xml`;
}
/** Aspera source path documented on helpApi.html */
export function iproxAsperaSource(ipx, username) {
    return `${username}@download.iprox.org:/data/iprox/${ipx.toUpperCase()}`;
}
async function iproxJsonp(endpoint, params) {
    const qs = new URLSearchParams(params).toString();
    const url = `${IPROX_BASE}/projectFileList/${endpoint}?${qs}`;
    return fetchJson(url, { timeoutMs: 30_000 });
}
/** Check whether iProX knows this project (code 200) or has no public data (222). */
export async function iproxGetProject(ipx) {
    return iproxJsonp("getProjectDataFileByProjectId.jsonp", {
        projectId: ipx.toUpperCase(),
    });
}
export async function iproxListProjectsByDay(date) {
    return iproxJsonp("getProjectDataFileByDay.jsonp", { date });
}
export async function iproxListProjectsByMonth(date) {
    return iproxJsonp("getProjectDataFileByMonth.jsonp", { date });
}
export async function iproxListProjectsByYear(date) {
    return iproxJsonp("getProjectDataFileByYear.jsonp", { date });
}
/** Download ProteomeXchange XML for an IPX accession (tries .org then .cn mirror). */
export async function fetchIproxPxXml(ipx) {
    const id = ipx.toUpperCase();
    let lastErr;
    for (const mirror of ["org", "cn"]) {
        const url = iproxPxXmlUrl(id, mirror);
        try {
            const xml = await fetchText(url, {
                timeoutMs: 60_000,
                accept: "application/xml,text/xml,*/*",
            });
            if (xml.includes("<ProteomeXchangeDataset"))
                return { xml, url };
            lastErr = new Error(`Not ProteomeXchange XML from ${url}`);
        }
        catch (err) {
            lastErr = err;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`Cannot fetch iProX XML for ${id}`);
}
/** Extract mirrored PXD accession from a ProteomeXchange XML string, if present. */
export function parsePxdFromPxXml(xml) {
    const m = xml.match(/\b(PXD\d{5,})\b/i);
    return m ? m[1].toUpperCase() : undefined;
}
/** Convert iProX nginx filePath to public HTTP download URL. */
export function iproxFilePathToHttpUrl(filePath, mirror = "org") {
    const host = mirror === "cn" ? IPROX_DOWNLOAD_HTTP_CN : IPROX_DOWNLOAD_HTTP;
    let rel = filePath.trim();
    rel = rel.replace(/^\/usr\/local\/nginx\/data\//i, "");
    rel = rel.replace(/^\\usr\\local\\nginx\\data\\/i, "");
    rel = rel.replace(/\\/g, "/");
    return `${host}/${rel}`;
}
/**
 * Fetch subproject metadata + files via PMD009Controller (used by subproject.html).
 * @see https://www.iprox.cn/page/subproject.html?id=IPX…
 */
export async function iproxFetchSubproject(subProjectId) {
    const id = subProjectId.toUpperCase();
    const res = await fetch(`${IPROX_BASE}/PMD009Controller/findBySubProjectId.jsonp`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "qPTM-CollectionAgent/0.1 (literature mining)",
        },
        body: `subProjectId=${encodeURIComponent(id)}&language=en`,
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
        return null;
    const json = (await res.json());
    const sub = json.data?.subProjectInfo;
    const files = json.data?.subdatafilesInfo ?? [];
    if (!sub?.subprojectId || sub.subprojectId.toUpperCase() !== id)
        return null;
    if (files.length === 0)
        return null;
    const parentProjectId = (sub.projectId ?? "").toUpperCase();
    const urls = [
        ...new Set(files
            .map((f) => iproxFilePathToHttpUrl(f.filePath))
            .filter((u) => u.startsWith("http"))),
    ];
    return { subproject: sub, parentProjectId, files, urls };
}
