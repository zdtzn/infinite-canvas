import { fetchChatConversation, fetchChatConversations, fetchChatMemories, type ChatConversationDetail, type ChatMemory, type ChatConversation } from "@/services/chat-api";
import { fetchServerUserPreferences, type ServerUserPreferences } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

export type ChatBootstrapRequests = {
    preferences: Promise<ServerUserPreferences>;
    memories: Promise<{ items: ChatMemory[] }>;
    conversations: Promise<{ items: ChatConversation[] }>;
    firstConversation: Promise<ChatConversationDetail | null>;
};

type ChatBootstrapLoaders = {
    preferences: (userId: string) => Promise<ServerUserPreferences>;
    memories: (userId: string) => Promise<{ items: ChatMemory[] }>;
    conversations: (userId: string) => Promise<{ items: ChatConversation[] }>;
    conversation: (id: string, userId: string) => Promise<ChatConversationDetail>;
};

type ChatBootstrapCacheOptions = {
    now?: () => number;
    ttlMs?: number;
};

export function createChatBootstrapCache(loaders: ChatBootstrapLoaders, options: ChatBootstrapCacheOptions = {}) {
    const now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? 15_000;
    const entries = new Map<string, { expiresAt: number; requests: ChatBootstrapRequests }>();

    const get = (userId: string) => {
        const existing = entries.get(userId);
        if (existing && existing.expiresAt > now()) return existing.requests;

        const conversations = loaders.conversations(userId);
        const requests: ChatBootstrapRequests = {
            preferences: loaders.preferences(userId),
            memories: loaders.memories(userId),
            conversations,
            firstConversation: conversations.then((response) => {
                const firstId = response.items[0]?.id;
                return firstId ? loaders.conversation(firstId, userId) : null;
            }),
        };
        entries.set(userId, { expiresAt: now() + ttlMs, requests });
        suppressUnhandledPrefetchRejections(requests);
        return requests;
    };

    return {
        get,
        prefetch(userId: string) {
            if (userId) get(userId);
        },
        clear(userId: string) {
            entries.delete(userId);
        },
    };
}

const chatBootstrapCache = createChatBootstrapCache({
    preferences: fetchServerUserPreferences,
    memories: fetchChatMemories,
    conversations: fetchChatConversations,
    conversation: fetchChatConversation,
});

export function getChatBootstrapRequests(userId: string) {
    return chatBootstrapCache.get(userId);
}

export function clearChatBootstrapCache(userId: string) {
    chatBootstrapCache.clear(userId);
}

export function prefetchChatBootstrapForCurrentUser() {
    const userId = useUserStore.getState().user?.id || "";
    chatBootstrapCache.prefetch(userId);
}

function suppressUnhandledPrefetchRejections(requests: ChatBootstrapRequests) {
    void requests.preferences.catch(() => undefined);
    void requests.memories.catch(() => undefined);
    void requests.conversations.catch(() => undefined);
    void requests.firstConversation.catch(() => undefined);
}
