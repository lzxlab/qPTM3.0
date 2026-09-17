/** Tokens that must never appear in user-visible assistant text. */
export declare const PROTOCOL_LEAK_RE: RegExp;
/** Normalize fullwidth pipes and repeated delimiters from some model outputs. */
export declare function normalizeProtocolText(text: string): string;
export declare function containsProtocolMarkup(text: string): boolean;
export declare function stripProtocolMarkup(text: string): {
    text: string;
    leaked: boolean;
};
export declare function failedGenerationMessage(): string;
/** If stripping leaves nothing readable, replace with a retry prompt. */
export declare function sanitizeUserVisibleText(text: string): string;
