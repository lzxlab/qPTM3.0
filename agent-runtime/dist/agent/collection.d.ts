import { ParsedEntities } from "../context/memory.js";
export declare function extractAccessions(text: string): string[];
export declare function looksLikeResolveUrlsRequest(message: string): boolean;
export declare function isCollectionUpload(filenames: string[] | undefined | null): boolean;
export declare function isCollectionRequest(message: string, entities: ParsedEntities, uploadFilenames?: string[]): boolean;
