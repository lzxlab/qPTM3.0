export type UploadFileKind = "fulltext" | "supplementary" | "unknown";
export declare function classifyUploadPath(filePath: string): UploadFileKind;
export declare function isTabularUpload(filePath: string): boolean;
export declare function isFulltextUpload(filePath: string): boolean;
