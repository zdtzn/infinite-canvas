import assert from "node:assert/strict";
import { test } from "node:test";

import { createChatBootstrapCache } from "./chat-bootstrap-cache";

function createLoaders() {
    const calls = { preferences: 0, memories: 0, conversations: 0, conversation: 0 };
    return {
        calls,
        loaders: {
            preferences: async () => {
                calls.preferences += 1;
                return { systemPrompt: "", chatPresetId: "general", chatPersona: "" };
            },
            memories: async () => {
                calls.memories += 1;
                return { items: [] };
            },
            conversations: async () => {
                calls.conversations += 1;
                return { items: [{ id: "conversation-1", title: "问道", presetId: "general", channelId: "", model: "", createdAt: 1, updatedAt: 1 }] };
            },
            conversation: async (id: string) => {
                calls.conversation += 1;
                return {
                    conversation: { id, title: "问道", presetId: "general", channelId: "", model: "", createdAt: 1, updatedAt: 1 },
                    messages: [],
                };
            },
        },
    };
}

test("deduplicates route prefetch and page bootstrap requests", async () => {
    const { loaders, calls } = createLoaders();
    const cache = createChatBootstrapCache(loaders);
    cache.prefetch("user-1");
    const first = cache.get("user-1");
    const second = cache.get("user-1");

    assert.equal(first, second);
    await Promise.all([first.preferences, first.memories, first.conversations, first.firstConversation]);
    assert.deepEqual(calls, { preferences: 1, memories: 1, conversations: 1, conversation: 1 });
});

test("expires and clears account-scoped bootstrap data", async () => {
    const { loaders, calls } = createLoaders();
    let now = 1_000;
    const cache = createChatBootstrapCache(loaders, { now: () => now, ttlMs: 100 });

    await cache.get("user-1").preferences;
    now += 101;
    await cache.get("user-1").preferences;
    cache.clear("user-1");
    await cache.get("user-1").preferences;

    assert.equal(calls.preferences, 3);
});
