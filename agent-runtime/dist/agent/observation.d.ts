import type { ArtifactPayload } from "../context/artifacts.js";
import type { QptmToolResult } from "../mcp/hub.js";
export declare function emptyCallKey(tool: string, args: Record<string, unknown>): string;
export declare function followableEntitiesFromPayload(payload: ArtifactPayload | undefined, exclude?: string[], max?: number): string[];
/** Honest tool observation for the ReAct scheduler (not user-visible). */
export declare function formatToolObservation(tool: string, result: QptmToolResult, payload?: ArtifactPayload, extraEntities?: string[], excludeEntities?: string[]): string;
