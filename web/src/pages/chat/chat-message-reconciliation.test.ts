import { describe, expect, test } from "bun:test";

import type { ChatMessage } from "@/services/chat-api";
import { mergeChatHistoryWithPendingTurn, mergeStartedChatMessages } from "./chat-message-reconciliation";

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
});
