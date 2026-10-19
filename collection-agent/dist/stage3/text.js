/**
 * Deterministic fulltext → LLM excerpt for Stage 3 meta extraction.
 * Prefer JATS Methods / Experimental sections; then PDF text; fall back to abstract.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stage2FulltextDir } from "../utils/io.js";
import { extractPdfText } from "./pdf.js";
const METHODS_TITLE = /\b(materials\s+and\s+methods|experimental\s+procedures?|experimental\s+design|methods?|method\s+details)\b/i;
const DATA_TITLE = /\b(data\s+availability|accession\s+numbers?|data\s+deposition)\b/i;
function decodeEntities(s) {
    return s
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function stripTags(xml) {
    let s = xml
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ");
    s = decodeEntities(s);
    return s.replace(/\s+/g, " ").trim();
}
function extractAbstract(xml) {
    const m = xml.match(/<abstract\b[^>]*>([\s\S]*?)<\/abstract>/i);
    return m ? stripTags(m[1]) : "";
}
/** Find methods-ish window in plain body text using title cues. */
function sliceMethodsWindow(bodyText) {
    const lower = bodyText.toLowerCase();
    // Prefer strong section headings; avoid author-contribution "methods, figures..."
    const strongCues = [
        "experimental procedures",
        "materials and methods",
        "materials & methods",
        "method details",
        "experimental design and statistical",
        "star methods",
    ];
    let start = -1;
    for (const cue of strongCues) {
        const i = lower.indexOf(cue);
        if (i >= 0 && (start < 0 || i < start))
            start = i;
    }
    if (start < 0) {
        // Standalone "Methods" / "METHODS" heading-like (not mid-sentence)
        const re = /(?:^|[\n\r.])\s*(methods?)\b/gi;
        let m;
        while ((m = re.exec(bodyText))) {
            const idx = m.index + m[0].toLowerCase().indexOf("method");
            const after = bodyText.slice(idx, idx + 80).toLowerCase();
            // Skip "methods, figures and tables" style author notes
            if (/methods?\s*,\s*figures?/.test(after))
                continue;
            if (/methods?\s+and\s+materials/.test(after) || after.startsWith("methods")) {
                start = idx;
                break;
            }
        }
    }
    if (start < 0)
        return "";
    const from = bodyText.slice(start);
    const stopCues = [
        "\nresults",
        " results",
        "discussion",
        "conclusions",
        "references",
        "acknowledgments",
        "acknowledgements",
        "conflict of interest",
        "author contributions",
        "supplementary",
    ];
    let end = from.length;
    const fromLower = from.toLowerCase();
    for (const cue of stopCues) {
        const i = fromLower.indexOf(cue, 120);
        if (i >= 0 && i < end)
            end = i;
    }
    const window = from.slice(0, end).trim();
    // Too short / no MS signal → treat as miss so caller can use fulltext windows
    if (window.length < 600 && !/mass spectrom|orbitrap|tmt|silac|enrich|lc-ms/i.test(window)) {
        return "";
    }
    return window;
}
function extractDataAvailability(bodyText) {
    const lower = bodyText.toLowerCase();
    let start = -1;
    for (const cue of ["data availability", "accession number", "data deposition"]) {
        const i = lower.indexOf(cue);
        if (i >= 0 && (start < 0 || i < start))
            start = i;
    }
    if (start < 0)
        return "";
    return bodyText.slice(start, start + 1500).trim();
}
function prioritizeMethodsText(methodsText, maxChars) {
    if (methodsText.length <= maxChars)
        return methodsText;
    const cues = [
        /lc-ms|orbitrap|q exactive|fusion lumos|exploris|timstof|mass spectrom\w*\s+(?:was|were|analysis|system)/i,
        /enrich|tio2|imac|fe-nta|fe\(iii\)|antibody|immunoaffinit|k-ε-gg|di.?gly|acetyl-lysine/i,
        /silac|tmt\b|itraq|label[- ]free|dimethyl|dia\b|isobaric|quantif/i,
        /sample|cell culture|tissue|strain|organism|growth condition/i,
        /treatment|stimulation|condition|time point|harvest/i,
    ];
    const picked = [];
    const lower = methodsText.toLowerCase();
    for (const re of cues) {
        const m = re.exec(lower);
        if (!m || m.index == null)
            continue;
        const start = Math.max(0, m.index - 120);
        const end = Math.min(methodsText.length, m.index + 1800);
        if (picked.some((p) => !(end <= p.start || start >= p.end)))
            continue;
        picked.push({ start, end, text: methodsText.slice(start, end) });
    }
    const headBudget = Math.floor(maxChars * 0.25);
    const tailBudget = Math.floor(maxChars * 0.1);
    const midBudget = maxChars - headBudget - tailBudget - 20;
    const head = methodsText.slice(0, headBudget);
    const tail = methodsText.slice(-tailBudget);
    let mid = "";
    for (const w of picked) {
        const piece = (mid ? "\n…\n" : "") + w.text;
        if (mid.length + piece.length > midBudget)
            break;
        mid += piece;
    }
    return `${head}\n…\n${mid}\n…\n${tail}`;
}
function extractFromXml(xml, maxChars) {
    const abstract = extractAbstract(xml);
    const bodyMatch = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodyXml = bodyMatch?.[1] ?? xml;
    const bodyText = stripTags(bodyXml);
    const titled = [];
    const titleRe = /<title\b[^>]*>([\s\S]*?)<\/title>/gi;
    let m;
    while ((m = titleRe.exec(bodyXml))) {
        titled.push({ title: stripTags(m[1]), start: m.index });
    }
    const chunks = [];
    const notes = [];
    let capturedMethods = false;
    for (let i = 0; i < titled.length; i++) {
        const { title, start } = titled[i];
        const isMethods = METHODS_TITLE.test(title);
        const isData = DATA_TITLE.test(title);
        if (!isMethods && !isData)
            continue;
        if (capturedMethods && isMethods)
            continue;
        if (isData && /PXD\d+|IPX\d+|MSV\d+/i.test(chunks.join("\n")))
            continue;
        let sliceEnd = bodyXml.length;
        for (let j = i + 1; j < titled.length; j++) {
            const t = titled[j].title.trim();
            if (isMethods) {
                if (/^(results?|discussion|conclusions?|references|acknowledg)/i.test(t)) {
                    sliceEnd = titled[j].start;
                    break;
                }
                continue;
            }
            if (/^(results?|discussion|references|supplement|conflict|author|funding|acknowledg)/i.test(t)) {
                sliceEnd = titled[j].start;
                break;
            }
            sliceEnd = titled[j].start;
            break;
        }
        let text = stripTags(bodyXml.slice(start, sliceEnd));
        if (text.length < 40)
            continue;
        if (isMethods) {
            text = prioritizeMethodsText(text, Math.max(6000, maxChars - 2500));
            capturedMethods = true;
        }
        else {
            text = text.slice(0, 1800);
        }
        chunks.push(`## ${title}\n${text}`);
        notes.push(title.slice(0, 60));
    }
    let excerpt = chunks.join("\n\n");
    if (excerpt.length < 400) {
        const window = sliceMethodsWindow(bodyText);
        if (window) {
            excerpt = prioritizeMethodsText(window, maxChars);
            notes.push("methods-window");
        }
    }
    const dataAvail = extractDataAvailability(bodyText);
    if (dataAvail && !/PXD\d+|IPX\d+|MSV\d+|dataset identifier/i.test(excerpt)) {
        excerpt = `${excerpt}\n\n## Data availability\n${dataAvail.slice(0, 1200)}`.trim();
    }
    if (!excerpt) {
        excerpt = bodyText.slice(0, maxChars);
        notes.push("body-fallback");
    }
    if (abstract && !excerpt.toLowerCase().includes(abstract.slice(0, 80).toLowerCase())) {
        excerpt = `## Abstract\n${abstract}\n\n${excerpt}`;
    }
    if (excerpt.length > maxChars) {
        excerpt = excerpt.slice(0, maxChars) + "\n…[truncated]";
        notes.push(`truncated:${maxChars}`);
    }
    return { excerpt, notes: notes.length ? `sections:${notes.join("|")}` : "xml-body" };
}
/** Build LLM excerpt from plain PDF text (no section structure). */
function extractFromPlainText(bodyText, abstractFromCsv, maxChars) {
    const notes = [];
    let methods = sliceMethodsWindow(bodyText);
    if (methods) {
        methods = prioritizeMethodsText(methods, Math.max(6000, maxChars - 2500));
        notes.push("methods-window");
    }
    else {
        methods = prioritizeMethodsText(bodyText, Math.max(6000, maxChars - 2500));
        notes.push("fulltext-window");
    }
    let excerpt = `## Extracted PDF text\n${methods}`;
    const dataAvail = extractDataAvailability(bodyText);
    if (dataAvail && !/PXD\d+|IPX\d+|MSV\d+/i.test(excerpt)) {
        excerpt = `${excerpt}\n\n## Data availability\n${dataAvail.slice(0, 1200)}`;
        notes.push("data-availability");
    }
    const abs = abstractFromCsv.trim();
    if (abs && !excerpt.toLowerCase().includes(abs.slice(0, Math.min(60, abs.length)).toLowerCase())) {
        excerpt = `## Abstract\n${abs}\n\n${excerpt}`;
    }
    if (excerpt.length > maxChars) {
        excerpt = excerpt.slice(0, maxChars) + "\n…[truncated]";
        notes.push(`truncated:${maxChars}`);
    }
    return { excerpt, notes: notes.join("|") };
}
export async function loadFulltextExcerpt(pmid, abstractFromCsv, options = {}) {
    const maxChars = options.maxChars ?? 14_000;
    const dir = join(stage2FulltextDir(), pmid);
    const xmlPath = join(dir, "fulltext.xml");
    const pdfCanonical = join(dir, "fulltext.pdf");
    const pdfAlt = join(dir, `${pmid}.pdf`);
    const pdfPath = existsSync(pdfCanonical)
        ? pdfCanonical
        : existsSync(pdfAlt)
            ? pdfAlt
            : pdfCanonical;
    const hasXml = existsSync(xmlPath);
    const hasPdf = existsSync(pdfPath);
    if (hasXml) {
        const xml = readFileSync(xmlPath, "utf8");
        const abs = extractAbstract(xml) || abstractFromCsv;
        const { excerpt, notes } = extractFromXml(xml, maxChars);
        return {
            textSource: "xml",
            abstract: abs,
            excerpt,
            hasXml,
            hasPdf,
            notes,
        };
    }
    if (hasPdf) {
        const abs = abstractFromCsv.trim();
        try {
            const pdf = await extractPdfText(pdfPath, { maxPages: 45, maxChars: 100_000 });
            if (pdf.text.replace(/\s+/g, "").length >= 200) {
                const { excerpt, notes } = extractFromPlainText(pdf.text, abs, maxChars);
                return {
                    textSource: "pdf",
                    abstract: abs,
                    excerpt,
                    hasXml,
                    hasPdf,
                    notes: `pdf-extract;${pdf.notes};${notes}`,
                };
            }
            return {
                textSource: abs ? "abstract" : "none",
                abstract: abs,
                excerpt: abs
                    ? `## Abstract\n${abs.slice(0, maxChars)}\n\n[Note: PDF text extraction yielded too little text; using abstract.]`
                    : "",
                hasXml,
                hasPdf,
                notes: `pdf-extract-thin;${pdf.notes}`,
            };
        }
        catch (err) {
            return {
                textSource: abs ? "abstract" : "none",
                abstract: abs,
                excerpt: abs
                    ? `## Abstract\n${abs.slice(0, maxChars)}\n\n[Note: PDF text extraction failed; using abstract.]`
                    : "",
                hasXml,
                hasPdf,
                notes: `pdf-extract-error:${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
    const abs = abstractFromCsv.trim();
    return {
        textSource: abs ? "abstract" : "none",
        abstract: abs,
        excerpt: abs ? `## Abstract\n${abs.slice(0, maxChars)}` : "",
        hasXml,
        hasPdf,
        notes: "no-fulltext",
    };
}
