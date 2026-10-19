export declare function extractPdfText(pdfPath: string, options?: {
    maxPages?: number;
    maxChars?: number;
}): Promise<{
    text: string;
    pages: number;
    notes: string;
}>;
