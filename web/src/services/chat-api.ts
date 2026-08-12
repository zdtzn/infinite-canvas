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
    presetId?: string;
    attachments: ChatAttachment[];
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

export function createChatConversation(input: { title?: string } = {}, expectedUserId?: string) {
    return serverRequest<{ conversation: ChatConversation }>("/api/chat/conversations", { method: "POST", body: input, expectedUserId });
}

export function fetchChatConversation(id: string, expectedUserId?: string) {
    return serverRequest<ChatConversationDetail>(`/api/chat/conversations/${encodeURIComponent(id)}`, { timeoutMs: 12_000, expectedUserId });
}

export function deleteChatConversation(id: string, expectedUserId?: string) {
    return serverRequest(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE", expectedUserId });
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
                presetId: input.presetId,
                attachments: input.attachments.map(({ assetKey, mimeType, name }) => ({ assetKey, mimeType, name })),
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
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            consumeServerEvents(state, decoder.decode(next.value, { stream: true }), input);
        }
        consumeServerEvents(state, decoder.decode(), input, true);
    } finally {
        reader.releaseLock();
    }
}

function consumeServerEvents(state: { buffer: string }, text: string, handlers: SendChatMessageInput, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeServerEventBlock(state.buffer.slice(0, index), handlers);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeServerEventBlock(state.buffer, handlers);
        state.buffer = "";
    }
}

function consumeServerEventBlock(block: string, handlers: SendChatMessageInput) {
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
    if (event === "started") handlers.onStarted?.(payload as ChatStartedEvent);
    else if (event === "delta") handlers.onDelta?.({ messageId: String(payload.messageId || ""), delta: String(payload.delta || "") });
    else if (event === "done") handlers.onDone?.(payload as ChatDoneEvent);
    else if (event === "error") handlers.onError?.({ messageId: String(payload.messageId || ""), message: String(payload.message || "问道台暂未回应") });
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
