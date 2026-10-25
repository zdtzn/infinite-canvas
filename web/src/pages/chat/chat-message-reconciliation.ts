import type { ChatMessage } from "@/services/chat-api";

export function mergeLoadedChatHistory(current: ChatMessage[], latest: ChatMessage[]) {
    if (!latest.length) return latest;
    const index = current.findIndex((item) => item.id === latest[0].id);
    return index < 0 ? latest : [...current.slice(0, index), ...latest];
}

type PendingChatTurnMessageIds = {
    optimisticUserId: string;
    optimisticAssistantId: string;
    userMessageId?: string;
    assistantMessageId?: string;
};

export function mergeChatHistoryWithPendingTurn(current: ChatMessage[], persisted: ChatMessage[], pending: PendingChatTurnMessageIds) {
    const currentById = new Map(current.map((item) => [item.id, item]));
    const mergedPersisted = persisted.map((item) => {
        const live = currentById.get(item.id);
        if (item.role === "assistant" && item.status === "streaming" && live?.status === "streaming" && live.content.length >= item.content.length) {
            return { ...item, content: live.content, updatedAt: Math.max(item.updatedAt, live.updatedAt) };
        }
        return item;
    });
    const persistedIds = new Set(mergedPersisted.map((item) => item.id));
    const transientIds = new Set([pending.optimisticUserId, pending.optimisticAssistantId, pending.userMessageId, pending.assistantMessageId].filter((id): id is string => Boolean(id)));
    const transientMessages = current.filter((item) => transientIds.has(item.id) && !persistedIds.has(item.id));
    return [...mergedPersisted, ...transientMessages].sort((left, right) => left.createdAt - right.createdAt);
}

export function mergeStartedChatMessages(
    current: ChatMessage[],
    pending: PendingChatTurnMessageIds,
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
    replaceOptimisticUser: boolean,
    stopped = false,
    editUserMessageId?: string,
) {
    const live = current.find((item) => item.id === assistantMessage.id);
    if (assistantMessage.status === "streaming" && live?.status === "streaming" && live.content.length > assistantMessage.content.length) {
        assistantMessage = { ...assistantMessage, content: live.content, updatedAt: Math.max(live.updatedAt, assistantMessage.updatedAt) };
    }
    if (editUserMessageId) {
        const index = current.findIndex((item) => item.id === editUserMessageId);
        if (index >= 0) return [...current.slice(0, index), userMessage, assistantMessage];
    }
    const hasUserMessage = current.some((item) => item.id === userMessage.id);
    const replaceIds = new Set([
        pending.optimisticAssistantId,
        assistantMessage.id,
        ...(replaceOptimisticUser ? [pending.optimisticUserId, userMessage.id] : []),
    ]);
    return [
        ...current.filter((item) => !replaceIds.has(item.id)),
        ...(replaceOptimisticUser || !hasUserMessage ? [userMessage] : []),
        stopped ? { ...assistantMessage, status: "failed" as const, error: "本次回答已停止" } : assistantMessage,
    ];
}
