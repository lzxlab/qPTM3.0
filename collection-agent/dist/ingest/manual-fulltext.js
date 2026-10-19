/**
 * Ingest user-uploaded fulltext (PDF or JATS XML) into Stage 2 layout.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fetchEuropePmcMeta } from "../stage2/clients/europepmc.js";
import { fulltextPmidDir } from "../stage2/fulltext.js";
function loadExistingMeta(metaPath) {
    if (!existsSync(metaPath))
        return {};
    try {
        return JSON.parse(readFileSync(metaPath, "utf8"));
    }
    catch {
        return {};
    }
}
export async function ingestManualFulltext(options) {
    const pmid = options.pmid.trim();
    if (!pmid)
        throw new Error("PMID is required");
    if (!existsSync(options.filePath)) {
        throw new Error(`File not found: ${options.filePath}`);
    }
    const dir = fulltextPmidDir(pmid);
    const metaPath = join(dir, "meta.json");
    const prior = loadExistingMeta(metaPath);
    const ext = extname(options.filePath).toLowerCase();
    let hasXml = Boolean(prior.hasXml);
    let hasPdf = Boolean(prior.hasPdf);
    let xmlPath = prior.xmlPath ?? null;
    let pdfPath = prior.pdfPath ?? null;
    if (ext === ".xml") {
        const dest = join(dir, "fulltext.xml");
        copyFileSync(options.filePath, dest);
        hasXml = true;
        xmlPath = dest;
    }
    else if (ext === ".pdf") {
        const dest = join(dir, "fulltext.pdf");
        copyFileSync(options.filePath, dest);
        hasPdf = true;
        pdfPath = dest;
    }
    else {
        throw new Error(`Unsupported fulltext type: ${ext} (use .pdf or .xml)`);
    }
    let doi = prior.doi ?? null;
    let pmcid = prior.pmcid ?? null;
    let title = options.title ?? prior.title ?? "";
    const noteBits = ["User-uploaded fulltext"];
    if (!options.skipIdLookup && (!doi || !pmcid || !title)) {
        try {
            const epmc = await fetchEuropePmcMeta(pmid);
            if (!doi && epmc.doi)
                doi = epmc.doi;
            if (!pmcid && epmc.pmcid)
                pmcid = epmc.pmcid;
            if (!title && epmc.title)
                title = epmc.title;
            if (epmc.doi || epmc.pmcid)
                noteBits.push("ids_from_europepmc");
        }
        catch {
            // offline / network — Stage4 will retry lookup
        }
    }
    const sources = [...new Set([...(prior.sources ?? []), "user_upload"])];
    const status = hasXml && hasPdf ? "ok" : hasXml || hasPdf ? "partial" : "unavailable";
    const fetchedAt = new Date().toISOString();
    const record = {
        pmid,
        title,
        status,
        doi,
        pmcid,
        hasXml,
        hasPdf,
        xmlPath: hasXml ? xmlPath : null,
        pdfPath: hasPdf ? pdfPath : null,
        sources,
        urls: prior.urls ?? [],
        notes: noteBits.join("; "),
        fetchedAt,
    };
    writeFileSync(metaPath, JSON.stringify(record, null, 2) + "\n", "utf8");
    return record;
}
