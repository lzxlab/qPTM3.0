export declare function initConversationsDb(): void;
export declare function createConversation(deviceId: string, title?: string): {
    id: `${string}-${string}-${string}-${string}-${string}`;
    title: string;
    created_at: string;
    updated_at: string;
};
export declare function listConversations(deviceId: string, limit?: number): Array<Record<string, string>>;
export declare function belongsToDevice(conversationId: string, deviceId: string): boolean;
export declare function getConversation(conversationId: string, deviceId: string): {
    messages: {
        meta: any;
    }[];
} | null;
export declare function deleteConversation(conversationId: string, deviceId: string): boolean;
export declare function saveConversationState(conversationId: string, state: Record<string, unknown>): void;
export declare function loadConversationState(conversationId: string): Record<string, unknown> | null;
export declare function clearConversationState(conversationId: string): void;
export declare function addMessage(conversationId: string, role: string, content: string, meta?: Record<string, unknown> | null): void;
export declare function updateTitle(conversationId: string, title: string): void;
export declare function titleFromMessage(msg: string): string;
