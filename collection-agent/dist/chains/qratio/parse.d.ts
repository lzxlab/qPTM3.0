import { type ColumnMapping } from "../../stage5/heuristic.js";
export declare class QratioMapParseError extends Error {
    readonly raw: string;
    constructor(message: string, raw: string);
}
export declare function parseQratioMapOutput(raw: string, meta: {
    entryPath: string;
    sheetName: string;
    headerRowIndex?: number;
}): ColumnMapping & {
    skip: boolean;
};
