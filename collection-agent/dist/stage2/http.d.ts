/** Small fetch helper with timeout + JSON/text */
export declare class HttpError extends Error {
    readonly status?: number | undefined;
    readonly url?: string | undefined;
    constructor(message: string, status?: number | undefined, url?: string | undefined);
}
export declare function fetchText(url: string, opts?: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    accept?: string;
}): Promise<string>;
export declare function fetchJson<T>(url: string, opts?: {
    timeoutMs?: number;
    headers?: Record<string, string>;
}): Promise<T>;
export declare function fetchBinary(url: string, opts?: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    accept?: string;
}): Promise<{
    buffer: Buffer;
    contentType: string | null;
}>;
