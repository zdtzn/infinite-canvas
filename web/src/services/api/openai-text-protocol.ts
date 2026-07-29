type TextMessage = { content?: unknown };

export type ChatCompletionStreamState = {
    buffer: string;
    text: string;
    error?: string;
};

export function openAiTextEndpoint(messages: TextMessage[]) {
    return messages.some((message) => messageContainsImage(message.content)) ? "/chat/completions" : "/responses";
}

export function chatCompletionPayloadText(payload: unknown) {
    if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";
    const choice = payload.choices.find(isRecord);
    if (!choice) return "";
    const message = isRecord(choice.message) ? choice.message : undefined;
    return typeof message?.content === "string" ? message.content : "";
}

export function consumeChatCompletionStreamText(state: ChatCompletionStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeChatCompletionStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeChatCompletionStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeChatCompletionStreamBlock(block: string, state: ChatCompletionStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;

    const payload = JSON.parse(data) as unknown;
    const error = payloadErrorMessage(payload);
    if (error) {
        state.error = error;
        return;
    }
    if (!isRecord(payload) || !Array.isArray(payload.choices)) return;
    const choice = payload.choices.find(isRecord);
    const delta = choice && isRecord(choice.delta) ? choice.delta : undefined;
    if (typeof delta?.content !== "string") return;
    state.text += delta.content;
    onDelta?.(state.text);
}

function messageContainsImage(content: unknown) {
    return Array.isArray(content) && content.some((item) => isRecord(item) && item.type === "image_url" && isRecord(item.image_url) && typeof item.image_url.url === "string");
}

function payloadErrorMessage(payload: unknown) {
    if (!isRecord(payload)) return "";
    const error = isRecord(payload.error) ? payload.error : undefined;
    return stringValue(payload.msg) || stringValue(error?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
