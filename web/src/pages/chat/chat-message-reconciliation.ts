import type { ChatMessage } from "@/services/chat-api";

type PendingChatTurnMessageIds = {
    optimisticUserId: string;
    optimisticAssistantId: string;
    userMessageId?: string;
    assistantMessageId?: string;
};

export function mergeChatHistoryWithPendingTurn(current: ChatMessage[], persisted: ChatMessage[], pending: PendingChatTurnMessageIds) {
    const persistedIds = new Set(persisted.map((item) => item.id));
    const transientIds = new Set([pending.optimisticUserId, pending.optimisticAssistantId, pending.userMessageId, pending.assistantMessageId].filter((id): id is string => Boolean(id)));
    const transientMessages = current.filter((item) => transientIds.has(item.id) && !persistedIds.has(item.id));
    return [...persisted, ...transientMessages].sort((left, right) => left.createdAt - right.createdAt);
}

export function mergeStartedChatMessages(
    current: ChatMessage[],
    pending: PendingChatTurnMessageIds,
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
    replaceOptimisticUser: boolean,
    stopped = false,
) {
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
