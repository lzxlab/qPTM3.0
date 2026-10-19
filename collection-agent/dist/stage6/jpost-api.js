/**
 * jPOST repository file API (paginated).
 *
 * The entry page is a SPA; file links are loaded via:
 *   GET https://repository.jpostdb.org/_api/file?projectId=JPST…&offset=…&num=…&target=public
 *
 * Public download URLs:
 *   https://storage.jpostdb.org/{JPST}/{fileName}
 */
import { fetchJson } from "../stage2/http.js";
const JPOST_REPO = "https://repository.jpostdb.org";
const JPOST_STORAGE = "https://storage.jpostdb.org";
export function jpostStorageUrl(jpst, fileName) {
    const base = jpst.toUpperCase().replace(/\.\d+$/, "");
    return `${JPOST_STORAGE}/${base}/${fileName}`;
}
/** Fetch all files for a JPST accession (paginated /_api/file). */
export async function jpostFetchAllFiles(jpst, opts = {}) {
    const id = jpst.toUpperCase();
    const pageSize = opts.pageSize ?? 100;
    const files = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
        const qs = new URLSearchParams({
            sortKey: "id",
            sortDir: "",
            offset: String(offset),
            num: String(pageSize),
            target: "public",
            projectId: id,
            searchKey: "",
            searchMode: "",
            keyword: "",
            fileType: "",
        });
        const url = `${JPOST_REPO}/_api/file?${qs}`;
        const page = await fetchJson(url, {
            timeoutMs: 60_000,
            headers: {
                Accept: "application/json",
                Referer: `${JPOST_REPO}/entry/${id}`,
            },
        });
        const batch = page.list ?? [];
        if (batch.length === 0)
            break;
        files.push(...batch);
        total = batch[0]?.total ?? files.length;
        offset += pageSize;
    }
    const urls = [
        ...new Set(files.map((f) => jpostStorageUrl(id, f.fileName)).filter(Boolean)),
    ];
    return { files, urls };
}
