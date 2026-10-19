/**
 * Extract plain text from a local PDF using pdfjs-dist (no OCR).
 */
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
export async function extractPdfText(pdfPath, options = {}) {
    const maxPages = options.maxPages ?? 40;
    const maxChars = options.maxChars ?? 80_000;
    const data = new Uint8Array(readFileSync(pdfPath));
    const loadingTask = getDocument({
        data,
        // Avoid fetching extra cmap/font assets over the network
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const parts = [];
    let total = 0;
    let usedPages = 0;
    try {
        for (let i = 1; i <= Math.min(pageCount, maxPages); i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items
                .map((item) => ("str" in item ? String(item.str) : ""))
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            if (pageText) {
                parts.push(pageText);
                total += pageText.length + 1;
                usedPages++;
            }
            if (total >= maxChars)
                break;
        }
    }
    finally {
        await doc.destroy();
    }
    let text = parts.join("\n\n").trim();
    const notes = [`pages:${usedPages}/${pageCount}`];
    if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        notes.push(`truncated:${maxChars}`);
    }
    return { text, pages: pageCount, notes: notes.join("|") };
}
