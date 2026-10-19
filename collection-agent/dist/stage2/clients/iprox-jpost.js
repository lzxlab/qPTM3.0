import { fetchText } from "../http.js";
import { extractAccessions } from "../accessions.js";
/** iProX: no stable public PMID search; validate known IPX via project page HTML. */
export async function lookupIprox(ipxId) {
    const id = ipxId.toUpperCase();
    if (!/^IPX\d+$/.test(id))
        return [];
    const url = `https://www.iprox.cn/page/project.html?id=${encodeURIComponent(id)}`;
    try {
        const html = await fetchText(url, { timeoutMs: 20_000 });
        const hits = extractAccessions(html, "iprox:page");
        if (!hits.some((h) => h.id === id)) {
            hits.unshift({ id, source: "iProX", via: "iprox:assumed" });
        }
        return hits;
    }
    catch {
        return [{ id, source: "iProX", via: "iprox:lookup-failed" }];
    }
}
/** jPOST: validate known JPST via repository page. */
export async function lookupJpost(jpstId) {
    const id = jpstId.toUpperCase();
    if (!/^JPST\d+$/.test(id))
        return [];
    const url = `https://repository.jpostdb.org/entry/${encodeURIComponent(id)}`;
    try {
        const html = await fetchText(url, { timeoutMs: 20_000 });
        const hits = extractAccessions(html, "jpost:page");
        if (!hits.some((h) => h.id === id)) {
            hits.unshift({ id, source: "jPOST", via: "jpost:assumed" });
        }
        return hits;
    }
    catch {
        return [{ id, source: "jPOST", via: "jpost:lookup-failed" }];
    }
}
