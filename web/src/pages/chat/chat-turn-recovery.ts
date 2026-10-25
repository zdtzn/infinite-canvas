import type { ChatMessage, ChatStartedEvent } from "@/services/chat-api";

export type ChatTurnAcceptance = {
    started: boolean;
    operationAccepted?: boolean;
    assistantMessageId?: string;
    previousAssistant?: ChatMessage;
    editUserMessageId?: string;
    retryAssistantMessageId?: string;
    continueAssistantMessageId?: string;
};

export function isAcceptedChatTurn(turn: ChatStartedEvent, pending: ChatTurnAcceptance) {
    if (pending.started) return turn.assistantMessage.id === pending.assistantMessageId;
    if (pending.operationAccepted) return true;
    const previous = pending.previousAssistant;
    if (pending.editUserMessageId) return !previous || turn.assistantMessage.id !== previous.id;
    if (pending.retryAssistantMessageId || pending.continueAssistantMessageId) {
        const current = turn.assistantMessage;
        return Boolean(previous && current.id === previous.id && (
            current.status === "streaming" || current.updatedAt > previous.updatedAt ||
            current.content !== previous.content || current.status !== previous.status || current.error !== previous.error
        ));
    }
    return true;
}

// The stream can disappear while its server task keeps running. Only persisted
// terminal state ends recovery; a failed status request is never a failed turn.
export async function recoverChatTurn(input: {
    read: () => Promise<ChatStartedEvent | null>;
    pending: ChatTurnAcceptance;
    isCurrent: () => boolean;
    onUpdate: (turn: ChatStartedEvent) => void;
    wait?: () => Promise<void>;
}) {
    const wait = input.wait || (() => new Promise<void>((resolve) => setTimeout(resolve, 1_200)));
    while (input.isCurrent()) {
        try {
            const turn = await input.read();
            if (!input.isCurrent()) return "stale" as const;
            if (turn && isAcceptedChatTurn(turn, input.pending)) {
                input.onUpdate(turn);
                if (turn.assistantMessage.status !== "streaming") return "terminal" as const;
            } else if (!input.pending.started) {
                return "missing" as const;
            }
        } catch {
            // Stay recoverable while offline, including when the first lookup fails.
        }
        if (input.isCurrent()) await wait();
    }
    return "stale" as const;
}

export function isChatSendBlocked(input: { uploading: boolean; starting: boolean; sending: boolean; pending: boolean; runtimePending: boolean; hasStreamingMessage: boolean; creating: boolean }) {
    return input.uploading || input.starting || input.sending || input.pending || input.runtimePending || input.hasStreamingMessage || input.creating;
}
