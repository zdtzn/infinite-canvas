import { describe, expect, test } from "bun:test";

import type { ChatMessage } from "@/services/chat-api";
import { mergeChatHistoryWithPendingTurn, mergeStartedChatMessages, mergeLoadedChatHistory } from "./chat-message-reconciliation";

function createMessage(id: string, role: ChatMessage["role"], overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id,
        conversationId: "conversation-1",
        role,
        content: role === "user" ? "你好" : "回答",
        attachments: [],
        status: "completed",
        error: "",
        createdAt: role === "user" ? 10 : 11,
        updatedAt: role === "user" ? 10 : 11,
        ...overrides,
    };
}

describe("chat message reconciliation", () => {
    test("latest-page refresh preserves loaded earlier pages and replaces only the refreshed tail", () => {
        const older = createMessage("older", "user");
        const last = createMessage("last", "assistant", { status: "streaming", content: "旧片段" });
        const done = { ...last, status: "completed" as const, content: "完整回答" };
        expect(mergeLoadedChatHistory([older, last], [done])).toEqual([older, done]);
    });

    test("accepted edits remove stale later messages while unrelated pages are replaced", () => {
        const older = createMessage("older", "user");
        const edited = createMessage("edited", "user", { content: "新问题" });
        const stale = createMessage("stale", "assistant");
        expect(mergeLoadedChatHistory([older, edited, stale], [edited])).toEqual([older, edited]);
        expect(mergeLoadedChatHistory([older], [stale])).toEqual([stale]);
    });

    test("uses the persisted user message instead of duplicating its optimistic twin", () => {
        const optimisticUser = createMessage("optimistic-user-123", "user", { status: "completed" });
        const persistedUser = createMessage("optimistic-user-123", "user", { updatedAt: 12 });
        const persistedAssistant = createMessage("assistant-1", "assistant", { status: "streaming", content: "" });

        const merged = mergeChatHistoryWithPendingTurn(
            [optimisticUser],
            [persistedUser, persistedAssistant],
            { optimisticUserId: optimisticUser.id, optimisticAssistantId: "optimistic-assistant-123" },
        );

        expect(merged.map((item) => item.id)).toEqual([persistedUser.id, persistedAssistant.id]);
        expect(merged.filter((item) => item.role === "user")).toHaveLength(1);
        expect(merged[0]).toBe(persistedUser);
    });

    test("keeps the optimistic user message while the server has not persisted it yet", () => {
        const optimisticUser = createMessage("optimistic-user-123", "user");
        const olderUser = createMessage("older-user", "user", { content: "Earlier question", createdAt: 1 });

        const merged = mergeChatHistoryWithPendingTurn(
            [olderUser, optimisticUser],
            [olderUser],
            { optimisticUserId: optimisticUser.id, optimisticAssistantId: "optimistic-assistant-123" },
        );

        expect(merged.map((item) => item.id)).toEqual([olderUser.id, optimisticUser.id]);
    });

    test("reconciles a started event when the client and server share the user message id", () => {
        const optimisticUser = createMessage("optimistic-user-123", "user");
        const persistedUser = createMessage(optimisticUser.id, "user", { updatedAt: 12 });
        const assistant = createMessage("assistant-1", "assistant", { status: "streaming", content: "" });

        const merged = mergeStartedChatMessages(
            [optimisticUser],
            { optimisticUserId: optimisticUser.id, optimisticAssistantId: "optimistic-assistant-123" },
            persistedUser,
            assistant,
            true,
        );

        expect(merged).toEqual([persistedUser, assistant]);
    });

    test("keeps the existing user message when reconciling a retry or edit turn", () => {
        const existingUser = createMessage("user-1", "user", { content: "Original question" });
        const assistant = createMessage("assistant-2", "assistant", { status: "streaming", content: "" });

        const merged = mergeStartedChatMessages(
            [existingUser],
            { optimisticUserId: "optimistic-user-456", optimisticAssistantId: "optimistic-assistant-456" },
            existingUser,
            assistant,
            false,
        );

        expect(merged).toEqual([existingUser, assistant]);
    });

    test("truncates the old branch only when an edit is accepted", () => {
        const user = createMessage("user-1", "user");
        const original = createMessage("assistant-1", "assistant");
        const next = createMessage("assistant-2", "assistant", { status: "streaming" });
        const edited = { ...user, content: "新问题" };
        expect(mergeStartedChatMessages([user, original], { optimisticUserId: "temp-u", optimisticAssistantId: "temp-a" }, edited, next, false, false, user.id)).toEqual([edited, next]);
        expect(user.content).toBe("你好");
        expect(original.status).toBe("completed");
    });

    test("recovery does not erase streamed text while persistence catches up", () => {
        const user = createMessage("u", "user");
        const live = createMessage("a", "assistant", { status: "streaming", content: "已收到的完整片段" });
        const persisted = { ...live, content: "已收到" };
        const merged = mergeStartedChatMessages([user, live], { optimisticUserId: "temp-u", optimisticAssistantId: "temp-a" }, user, persisted, false);
        expect(merged.at(-1)?.content).toBe(live.content);
    });
});
