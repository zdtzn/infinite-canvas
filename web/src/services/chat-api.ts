import { friendlyErrorMessage } from "@/lib/friendly-error";
import { fetchServerResource, serverRequest, uploadServerAsset } from "@/services/server-api";

export type ChatAttachment = {
    assetKey: string;
    mimeType: string;
    name: string;
    url?: string;
};

export type ChatMessage = {
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    attachments: ChatAttachment[];
    status: "streaming" | "completed" | "failed";
    error: string;
    createdAt: number;
    updatedAt: number;
};

export type ChatConversation = {
    id: string;
    title: string;
    presetId: string;
    channelId: string;
    model: string;
    createdAt: number;
    updatedAt: number;
    lastMessage?: string;
};

export type ChatConversationDetail = {
    conversation: ChatConversation;
    messages: ChatMessage[];
};

export type ChatImportResult = {
    conversation: ChatConversation;
    messages: ChatMessage[];
    skippedAttachmentCount: number;
};

export type ChatUsage = {
    usageDate: string;
    dailyLimit: number | null;
    usedToday: number;
    remainingToday: number | null;
    inputCharacters: number;
    outputCharacters: number;
};

export type ChatMemory = {
    id: string;
    kind: "summary" | "fact" | "preference" | "goal";
    content: string;
    sourceConversationId: string;
    pinned: boolean;
    createdAt: number;
    updatedAt: number;
};

export type ChatCanvasContext = {
    projectId: string;
    projectTitle: string;
    nodes: Array<{ id: string; type: string; title: string; text?: string; storageKey?: string }>;
};

export type ChatStartedEvent = {
    conversation: ChatConversation;
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
};

export type ChatDoneEvent = {
    conversation: ChatConversation;
    message: ChatMessage;
};

export type SendChatMessageInput = {
    conversationId: string;
    content: string;
    attachments: ChatAttachment[];
    retryAssistantMessageId?: string;
    editUserMessageId?: string;
    continueAssistantMessageId?: string;
    canvasContext?: ChatCanvasContext;
    expectedUserId?: string;
    signal?: AbortSignal;
    onStarted?: (event: ChatStartedEvent) => void;
    onDelta?: (event: { messageId: string; delta: string }) => void;
    onDone?: (event: ChatDoneEvent) => void;
    onError?: (event: { messageId?: string; message: string }) => void;
};

export function fetchChatConversations(expectedUserId?: string) {
    return serverRequest<{ items: ChatConversation[] }>("/api/chat/conversations", { timeoutMs: 12_000, expectedUserId });
}

export function createChatConversation(input: { title?: string; presetId?: string } = {}, expectedUserId?: string) {
    return serverRequest<{ conversation: ChatConversation }>("/api/chat/conversations", { method: "POST", body: input, expectedUserId });
}

export function fetchChatMemories(expectedUserId?: string) {
    return serverRequest<{ items: ChatMemory[] }>("/api/chat/memories", { timeoutMs: 12_000, expectedUserId });
}

export function createChatMemory(input: Pick<ChatMemory, "kind" | "content"> & Partial<Pick<ChatMemory, "sourceConversationId" | "pinned">>, expectedUserId?: string) {
    return serverRequest<{ memory: ChatMemory }>("/api/chat/memories", { method: "POST", body: input, expectedUserId });
}

export function updateChatMemory(id: string, input: Partial<Pick<ChatMemory, "kind" | "content" | "pinned">>, expectedUserId?: string) {
    return serverRequest<{ memory: ChatMemory }>(`/api/chat/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: input, expectedUserId });
}

export function deleteChatMemory(id: string, expectedUserId?: string) {
    return serverRequest(`/api/chat/memories/${encodeURIComponent(id)}`, { method: "DELETE", expectedUserId });
}

export function importChatConversation(payload: unknown, expectedUserId?: string) {
    return serverRequest<ChatImportResult>("/api/chat/conversations/import", {
        method: "POST",
        body: payload,
        timeoutMs: 30_000,
        expectedUserId,
    });
}

export function updateChatConversationPreset(id: string, presetId: string, expectedUserId?: string) {
    return serverRequest<{ conversation: ChatConversation }>(`/api/chat/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { presetId },
        expectedUserId,
    });
}

export function fetchChatConversation(id: string, expectedUserId?: string) {
    return serverRequest<ChatConversationDetail>(`/api/chat/conversations/${encodeURIComponent(id)}`, { timeoutMs: 12_000, expectedUserId });
}

export function deleteChatConversation(id: string, expectedUserId?: string) {
    return serverRequest(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE", expectedUserId });
}

export function truncateChatMessages(conversationId: string, messageId: string, expectedUserId?: string) {
    return serverRequest<ChatConversationDetail>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/truncate`,
        { method: "POST", expectedUserId },
    );
}

export function cancelChatMessage(conversationId: string, messageId: string, expectedUserId?: string) {
    return serverRequest<{ ok: true }>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/cancel`,
        { method: "POST", expectedUserId },
    );
}

export function fetchChatUsage(expectedUserId?: string) {
    return serverRequest<{ usage: ChatUsage }>("/api/chat/usage", { timeoutMs: 12_000, expectedUserId });
}

export async function uploadChatImage(file: File, expectedUserId?: string) {
    const response = await uploadServerAsset(file, "image", undefined, expectedUserId);
    return { assetKey: response.asset.key, mimeType: response.asset.mimeType, name: file.name || "图片", url: response.asset.url } satisfies ChatAttachment;
}

export async function sendChatMessage(input: SendChatMessageInput) {
    const response = await fetchServerResource(
        `/api/chat/conversations/${encodeURIComponent(input.conversationId)}/messages`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: input.content,
                attachments: input.attachments.map(({ assetKey, mimeType, name }) => ({ assetKey, mimeType, name })),
                ...(input.retryAssistantMessageId ? { retryAssistantMessageId: input.retryAssistantMessageId } : {}),
                ...(input.editUserMessageId ? { editUserMessageId: input.editUserMessageId } : {}),
                ...(input.continueAssistantMessageId ? { continueAssistantMessageId: input.continueAssistantMessageId } : {}),
                ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
            }),
            signal: input.signal,
        },
        input.expectedUserId,
    );

    if (!response.ok) throw new Error(await readErrorResponse(response));
    if (!response.body) throw new Error("问道台没有返回可读响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state = { buffer: "" };
    const lifecycle = { started: false, terminal: false };
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            consumeServerEvents(state, decoder.decode(next.value, { stream: true }), input, false, lifecycle);
        }
        consumeServerEvents(state, decoder.decode(), input, true, lifecycle);
        if (!lifecycle.started) throw new Error("问道台没有开始回应，请重试");
        if (!lifecycle.terminal) throw new Error("问道台回应中途断开，请重试");
    } finally {
        reader.releaseLock();
    }
}

function consumeServerEvents(
    state: { buffer: string },
    text: string,
    handlers: SendChatMessageInput,
    flush = false,
    lifecycle?: { started: boolean; terminal: boolean },
) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeServerEventBlock(state.buffer.slice(0, index), handlers, lifecycle);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeServerEventBlock(state.buffer, handlers, lifecycle);
        state.buffer = "";
    }
}

function consumeServerEventBlock(block: string, handlers: SendChatMessageInput, lifecycle?: { started: boolean; terminal: boolean }) {
    const event = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!event || !data) return;
    const payload = safeJson(data) as Record<string, unknown>;
    if (event === "started") {
        if (lifecycle) lifecycle.started = true;
        handlers.onStarted?.(payload as ChatStartedEvent);
    } else if (event === "delta") handlers.onDelta?.({ messageId: String(payload.messageId || ""), delta: String(payload.delta || "") });
    else if (event === "done") {
        if (lifecycle) lifecycle.terminal = true;
        handlers.onDone?.(payload as ChatDoneEvent);
    } else if (event === "error") {
        if (lifecycle) lifecycle.terminal = true;
        handlers.onError?.({ messageId: String(payload.messageId || ""), message: String(payload.message || "问道台暂未回应") });
    }
}

async function readErrorResponse(response: Response) {
    const text = await response.text();
    const payload = text ? safeJson(text) : {};
    const message = readServerError(payload) || response.statusText || "请求失败";
    return friendlyErrorMessage(message, response.status);
}

function readServerError(payload: unknown) {
    const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    const error = root?.error && typeof root.error === "object" ? (root.error as Record<string, unknown>) : undefined;
    return typeof error?.message === "string" ? error.message : typeof root?.message === "string" ? root.message : "";
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}
