export interface IproxApiResponse<T> {
    code: number;
    message: string;
    data: T;
}
export declare function iproxPxXmlUrl(ipx: string, mirror?: "org" | "cn"): string;
/** Aspera source path documented on helpApi.html */
export declare function iproxAsperaSource(ipx: string, username: string): string;
/** Check whether iProX knows this project (code 200) or has no public data (222). */
export declare function iproxGetProject(ipx: string): Promise<IproxApiResponse<string>>;
export declare function iproxListProjectsByDay(date: string): Promise<IproxApiResponse<string[]>>;
export declare function iproxListProjectsByMonth(date: string): Promise<IproxApiResponse<string[]>>;
export declare function iproxListProjectsByYear(date: string): Promise<IproxApiResponse<string[]>>;
/** Download ProteomeXchange XML for an IPX accession (tries .org then .cn mirror). */
export declare function fetchIproxPxXml(ipx: string): Promise<{
    xml: string;
    url: string;
}>;
/** Extract mirrored PXD accession from a ProteomeXchange XML string, if present. */
export declare function parsePxdFromPxXml(xml: string): string | undefined;
export interface IproxSubprojectFile {
    fileId: string;
    fileName: string;
    filePath: string;
    fileType?: string;
}
export interface IproxSubprojectInfo {
    subprojectId: string;
    projectId: string;
    proteomexchangeId?: string | null;
    subtitleEn?: string | null;
}
/** Convert iProX nginx filePath to public HTTP download URL. */
export declare function iproxFilePathToHttpUrl(filePath: string, mirror?: "org" | "cn"): string;
/**
 * Fetch subproject metadata + files via PMD009Controller (used by subproject.html).
 * @see https://www.iprox.cn/page/subproject.html?id=IPX…
 */
export declare function iproxFetchSubproject(subProjectId: string): Promise<{
    subproject: IproxSubprojectInfo;
    parentProjectId: string;
    files: IproxSubprojectFile[];
    urls: string[];
} | null>;
