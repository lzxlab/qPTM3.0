import type { ScreenResult } from "../../types.js";
export declare class ScreenParseError extends Error {
    readonly raw: string;
    constructor(message: string, raw: string);
}
export declare function parseScreenOutput(raw: string, meta: {
    pmid: string;
    title: string;
    sourceFile: string;
}): ScreenResult;
