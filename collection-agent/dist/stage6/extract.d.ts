export interface GetUrlScripts {
    prideHtml: string;
    iproxXml: string;
    jpostHtml: string;
    pdcExtract: string;
}
export declare function resolveGetUrlDir(custom?: string): string;
export declare function resolveGetUrlScripts(customDir?: string): GetUrlScripts;
export declare function countRawUrls(urls: string[]): number;
export interface ExtractOutcome {
    urlsFile: string;
    urls: string[];
    rawUrlCount: number;
}
export declare function runPrideExtract(htmlPath: string, scripts: GetUrlScripts, workDir: string): ExtractOutcome;
export declare function runIproxExtract(xmlPath: string, scripts: GetUrlScripts): ExtractOutcome;
export declare function runJpostExtract(htmlPath: string, scripts: GetUrlScripts): ExtractOutcome;
export declare function runPdcExtract(pdcId: string, scripts: GetUrlScripts): ExtractOutcome;
