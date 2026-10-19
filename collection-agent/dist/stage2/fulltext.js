import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchBinary } from "./http.js";
import { europePmcPdfUrl, fetchEuropePmcFullTextXml, fetchEuropePmcMeta, fetchEuropePmcPdf, } from "./clients/europepmc.js";
import { lookupUnpaywall } from "./clients/unpaywall.js";
import { stage2Dir } from "../utils/io.js";
export function fulltextRootDir() {
    const dir = join(stage2Dir(), "fulltext");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function fulltextPmidDir(pmid) {
    const dir = join(fulltextRootDir(), pmid);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function looksLikePdf(buffer, contentType) {
    if (buffer.length < 1000)
        return false;
    if (buffer.subarray(0, 4).toString("ascii") === "%PDF")
        return true;
    return (contentType ?? "").toLowerCase().includes("pdf");
}
async function downloadPdfToFile(url, destPath) {
    const { buffer, contentType } = await fetchBinary(url, {
        timeoutMs: 90_000,
        accept: "application/pdf,*/*",
    });
    if (!looksLikePdf(buffer, contentType))
        return false;
    writeFileSync(destPath, buffer);
    return true;
}
function unpaywallEmail() {
    const email = process.env.UNPAYWALL_EMAIL?.trim();
    if (email)
        return email;
    // Unpaywall requires an email; use a project-local placeholder if unset
    return "qptm-collection-agent@localhost";
}
/**
 * Cascaded OA fulltext fetch (no paywall bypass):
 * 1) Europe PMC XML + PDF when pmcid present
 * 2) Unpaywall OA PDF by DOI
 * 3) unavailable → manual queue
 */
export async function fetchFulltextForPmid(input) {
    const fetchedAt = new Date().toISOString();
    const dir = fulltextPmidDir(input.pmid);
    const xmlPath = join(dir, "fulltext.xml");
    const pdfPath = join(dir, "fulltext.pdf");
    const metaPath = join(dir, "meta.json");
    let doi = input.doi ?? null;
    let pmcid = input.pmcid ?? null;
    let title = input.title ?? "";
    const sources = [];
    const urls = [];
    let hasXml = false;
    let hasPdf = false;
    let notes = "";
    try {
        if (!doi || !pmcid || !title) {
            const meta = await fetchEuropePmcMeta(input.pmid);
            doi = doi ?? meta.doi;
            pmcid = pmcid ?? meta.pmcid;
            if (!title && meta.title)
                title = meta.title;
        }
        if (pmcid) {
            const xml = await fetchEuropePmcFullTextXml(pmcid);
            if (xml && xml.includes("<article")) {
                writeFileSync(xmlPath, xml, "utf8");
                hasXml = true;
                sources.push("europepmc:xml");
                const id = pmcid.replace(/^PMC/i, "");
                urls.push(`https://www.ebi.ac.uk/europepmc/webservices/rest/PMC${id}/fullTextXML`);
            }
            const pdfBuf = await fetchEuropePmcPdf(pmcid);
            if (pdfBuf) {
                writeFileSync(pdfPath, pdfBuf);
                hasPdf = true;
                sources.push("europepmc:pdf");
                urls.push(europePmcPdfUrl(pmcid));
            }
        }
        if (!hasPdf && doi) {
            try {
                const hit = await lookupUnpaywall(doi, unpaywallEmail());
                if (hit.isOa && hit.pdfUrl) {
                    const ok = await downloadPdfToFile(hit.pdfUrl, pdfPath);
                    if (ok) {
                        hasPdf = true;
                        sources.push(`unpaywall:${hit.source ?? "oa"}`);
                        urls.push(hit.pdfUrl);
                    }
                    else {
                        notes = "Unpaywall returned URL but payload was not PDF";
                    }
                }
                else if (!hit.isOa) {
                    notes = notes || "Unpaywall: not OA";
                }
                else {
                    notes = notes || "Unpaywall: OA but no pdf_url";
                }
            }
            catch (err) {
                notes = `Unpaywall error: ${err instanceof Error ? err.message : String(err)}`;
            }
        }
        const status = hasXml && hasPdf ? "ok" : hasXml || hasPdf ? "partial" : "unavailable";
        if (status === "unavailable" && !notes) {
            notes = "No legal OA fulltext found (Europe PMC / Unpaywall)";
        }
        else if (status !== "unavailable" && !notes) {
            notes = `Fetched via ${sources.join(", ")}`;
        }
        const record = {
            pmid: input.pmid,
            title,
            status,
            doi,
            pmcid,
            hasXml,
            hasPdf,
            xmlPath: hasXml ? xmlPath : null,
            pdfPath: hasPdf ? pdfPath : null,
            sources,
            urls,
            notes,
            fetchedAt,
        };
        writeFileSync(metaPath, JSON.stringify(record, null, 2), "utf8");
        return record;
    }
    catch (err) {
        const record = {
            pmid: input.pmid,
            title,
            status: "error",
            doi,
            pmcid,
            hasXml,
            hasPdf,
            xmlPath: hasXml ? xmlPath : null,
            pdfPath: hasPdf ? pdfPath : null,
            sources,
            urls,
            notes: "Fulltext fetch failed",
            fetchedAt,
            error: err instanceof Error ? err.message : String(err),
        };
        writeFileSync(metaPath, JSON.stringify(record, null, 2), "utf8");
        return record;
    }
}
