import { ParsedEntities } from "../context/memory.js";
export type QueryMode = "greeting" | "help" | "capability" | "off_topic" | "concept" | "research" | "literature" | "pmid_lookup" | "collection" | "compare" | "followup";
/** Always-English instruction: user-visible answers follow the user's question language. */
export declare const ANSWER_LANGUAGE_RULE = "Write the user-visible answer in Chinese only if the user's question is in Chinese; otherwise English.";
export declare function detectLang(text: string): "zh" | "en";
export declare function extractAccessions(text: string): string[];
export declare function looksLikeResolveUrlsRequest(message: string): boolean;
export declare function isCollectionUpload(filenames: string[] | undefined | null): boolean;
export declare function isCollectionRequest(message: string, entities: ParsedEntities, uploadFilenames?: string[]): boolean;
/** Greeting / concept / refuse — never run Deep Research tools or clarification. */
export declare function shouldSkipInvestigation(mode: QueryMode): boolean;
export declare function ptmResearchSteer(lang: "zh" | "en"): string;
export declare function classifyQueryMode(message: string, entities: ParsedEntities, uploadFilenames?: string[]): QueryMode;
export declare function gateReply(mode: QueryMode, lang: "zh" | "en"): string | null;
export declare function needsLiterature(message: string): boolean;
