import axios from "axios";

import { defaultConfig, normalizeImageSizeSelection, resolveModelRequestConfig, resolveModelScript, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { normalizePluginImages, runModelPlugin } from "./model-plugin";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { extractApiErrorMessage } from "@/lib/friendly-error";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { resolveImageRequestSize } from "@/lib/image-request-size";
import { imageToDataUrl } from "@/services/image-storage";
import { cancelServerJob, saveServerChannel, submitImageJob, waitForServerJob } from "@/services/server-api";
import { deriveImageModelCapabilities, supportsGeminiImageSize, validateImageRequest } from "@/stores/model-capabilities";
import { resolveImageModelSettings } from "@/stores/image-model-settings";
import { useUserStore } from "@/stores/use-user-store";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { geminiApiBase, geminiProviderHeaders, isServerManagedConfig, openAiApiUrl, providerHeaders, type ManagedAiConfig } from "./gateway";
import { chatCompletionPayloadText, consumeChatCompletionStreamText, openAiTextEndpoint, type ChatCompletionStreamState } from "./openai-text-protocol";
import type { ReferenceImage } from "@/types/image";

export { resolveImageRequestSize } from "@/lib/image-request-size";

export type RequestedImage = {
    id: string;
    dataUrl: string;
    width?: number;
    height?: number;
    bytes?: number;
    durationMs?: number;
    mimeType?: string;
};

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem =
    | { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem =
    | { type?: "message"; content?: Array<{ type?: string; text?: string }> }
    | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    images?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
export type RequestOptions = {
    signal?: AbortSignal;
    onJobCreated?: (jobId: string) => void;
    source?: { route?: string; projectId?: string; nodeId?: string; label?: string };
    expectedUserId?: string;
};

const RESOLUTION_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 3840,
    standard: 1024,
    hd: 2048,
};
const RESOLUTION_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const IMAGE_MAX_RATIO = 3;
const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const GEMINI_IMAGE_SIZE_BY_RESOLUTION: Record<string, string> = { low: "1K", medium: "2K", high: "4K", standard: "1K", hd: "2K" };

function normalizeResolution(resolution: string | undefined) {
    const value = String(resolution || "low").trim().toLowerCase();
    if (!value || value === "auto") return "low";
    const normalized = RESOLUTION_ALIASES[value] || value;
    return RESOLUTION_BASE[normalized] ? normalized : undefined;
}

function normalizeImageQuality(quality: string | undefined) {
    const value = String(quality || "auto").trim().toLowerCase();
    if (!value || value === "auto") return undefined;
    return ["low", "medium", "high", "standard", "hd"].includes(value) ? value : undefined;
}

function normalizeImageOutputFormat(format: string | undefined) {
    const value = String(format || "auto").trim().toLowerCase();
    if (!value || value === "auto") return undefined;
    return ["png", "jpeg", "webp"].includes(value) ? value : undefined;
}

/** Do not leak a stale model-quality setting into channels that do not support it. */
function resolveSupportedImageQuality(config: Pick<AiConfig, "model" | "apiFormat" | "baseUrl" | "imageQuality">) {
    const quality = normalizeImageQuality(config.imageQuality);
    if (!quality) return undefined;
    const capabilities = deriveImageModelCapabilities(config.model, config.apiFormat, config.baseUrl);
    return capabilities.generationQualities.includes(quality) ? quality : undefined;
}

/** Only forward output_format when the selected model documents that capability. */
function resolveSupportedImageOutputFormat(config: Pick<AiConfig, "model" | "apiFormat" | "baseUrl" | "imageOutputFormat" | "background">) {
    const format = normalizeImageOutputFormat(config.imageOutputFormat);
    if (!format || (format === "jpeg" && normalizeBackground(config.background) === "transparent")) return undefined;
    const capabilities = deriveImageModelCapabilities(config.model, config.apiFormat, config.baseUrl);
    return capabilities.outputFormats.includes(format) ? format : undefined;
}

function imageOutputFormatMimeType(format?: string) {
    return ({ jpeg: "image/jpeg", webp: "image/webp", png: "image/png" } as Record<string, string>)[String(format || "").toLowerCase()] || "image/png";
}

/** Only "transparent" is forwarded; any other value (incl. empty) means keep the default opaque background. */
function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return ratio;
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function resolveGeminiImageConfig(config: AiConfig) {
    const value = normalizeImageSizeSelection(config.size);
    const dimensions = parseImageDimensions(value);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : value;
    const aspectRatio = closestGeminiAspectRatio(ratio);
    const imageSize = supportsGeminiImageSize(config.model) ? resolveGeminiImageSize(config.quality, dimensions) : undefined;
    const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
    return Object.keys(image).length ? { responseFormat: { image } } : {};
}

function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseRatioValue(item);
        const bestRatio = parseRatioValue(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

function resolveGeminiImageSize(resolution: string, dimensions: { width: number; height: number } | null) {
    const normalizedResolution = normalizeResolution(resolution);
    if (normalizedResolution) return GEMINI_IMAGE_SIZE_BY_RESOLUTION[normalizedResolution];
    if (!dimensions) return undefined;
    const edge = Math.max(dimensions.width, dimensions.height);
    if (edge <= 768) return "512";
    if (edge <= 1536) return "1K";
    if (edge <= 3072) return "2K";
    return "4K";
}

function resolveImageDataUrl(item: Record<string, unknown>, mimeType: string) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:${mimeType};base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse, mimeType = "image/png") {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }
    const imageItems = [payload.data, payload.images, payload.results].find((items) => Array.isArray(items) && items.length > 0) || [];
    const images =
        imageItems
            ?.map((item) => resolveImageDataUrl(item, mimeType))
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError(error)) {
        return extractApiErrorMessage(error.response?.data) || readStatusError(error.response?.status, fallback) || error.message || fallback;
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return extractApiErrorMessage(error) || fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    if (status === 404) return "接口地址不存在（404），请检查 Base URL 和模型选择";
    if (status === 502) return "网关错误（502），接口服务暂时不可用，请稍后重试";
    if (status === 503) return "服务繁忙（503），请稍后重试";
    return status ? `${fallback}（HTTP ${status}）` : fallback;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: ManagedAiConfig, path: string) {
    return openAiApiUrl(config, path);
}

function aiHeaders(config: ManagedAiConfig, contentType?: string) {
    return providerHeaders(config, contentType);
}

function geminiBaseUrl(config: ManagedAiConfig) {
    return geminiApiBase(config);
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: ManagedAiConfig, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

function geminiHeaders(config: ManagedAiConfig) {
    return geminiProviderHeaders(config);
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

async function requestStreamingChatCompletion(config: AiConfig, messages: AiTextMessage[], onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/chat/completions"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({
            model: config.model,
            messages: withSystemMessage(config, messages),
            stream: true,
            ...(config.reasoningEffort === "auto" ? {} : { reasoning_effort: config.reasoningEffort }),
        }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "Request failed"));

    const contentType = response.headers.get("content-type") || "";
    if (!response.body || !contentType.includes("text/event-stream")) {
        const payload = (await response.json()) as unknown;
        const error = responseErrorMessage(payload);
        if (error) throw new Error(error);
        const content = chatCompletionPayloadText(payload);
        if (content) onDelta?.(content);
        return { content, toolCalls: [] };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ChatCompletionStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeChatCompletionStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeChatCompletionStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: [] };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [
        config.systemPrompt.trim(),
        ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : [])),
    ]
        .filter(Boolean)
        .join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig =
        typeof toolChoice === "object"
            ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] }
            : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await imageToDataUrl(image)));
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(config) } }),
            contents: [{ role: "user", parts }],
        },
        { headers: geminiHeaders(config), signal: options?.signal },
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

function resolveImageRequestContext(config: AiConfig, referenceCount: number) {
    const selectedModel = config.imageModel || config.model;
    const resolved = resolveImageModelSettings(config, selectedModel);
    const requestConfig = resolveModelRequestConfig(resolved.config, selectedModel);
    const count = Number(resolved.config.count);
    validateImageRequest(resolved.capabilities, {
        resolution: resolved.config.quality,
        imageQuality: resolved.config.imageQuality,
        imageOutputFormat: resolved.config.imageOutputFormat,
        size: resolved.config.size,
        background: resolved.config.background,
        referenceCount,
        count,
    });
    return { selectedModel, config: resolved.config, requestConfig, count };
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<RequestedImage[]> {
    const resolved = resolveImageRequestContext(config, 0);
    const requestConfig = resolved.requestConfig;
    const effectiveConfig = resolved.config;
    const n = resolved.count;
    if (isServerManagedConfig(requestConfig)) return requestServerImageJob(requestConfig, prompt, [], undefined, n, options);
    const script = resolveModelScript(effectiveConfig, resolved.selectedModel);
    if (script) {
        const resolution = effectiveConfig.quality === "auto" ? undefined : normalizeResolution(effectiveConfig.quality);
        const imageQuality = resolveSupportedImageQuality(requestConfig);
        const imageOutputFormat = resolveSupportedImageOutputFormat(requestConfig);
        const requestSize = resolveImageRequestSize(resolution, effectiveConfig.size, requestConfig.model);
        const background = normalizeBackground(effectiveConfig.background);
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, prompt),
                images: [],
                params: { size: requestSize, resolution, quality: imageQuality, outputFormat: imageOutputFormat, count: n, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const resolution = normalizeResolution(effectiveConfig.quality);
    const imageQuality = resolveSupportedImageQuality(requestConfig);
    const imageOutputFormat = resolveSupportedImageOutputFormat(requestConfig);
    const requestSize = resolveImageRequestSize(resolution, effectiveConfig.size, requestConfig.model);
    const background = normalizeBackground(effectiveConfig.background);
    try {
        const response = await axios.post<ImageApiResponse>(
            aiApiUrl(requestConfig, "/images/generations"),
            {
                model: requestConfig.model,
                prompt: withSystemPrompt(requestConfig, prompt),
                ...(n > 1 ? { n } : {}),
                ...(imageQuality ? { quality: imageQuality } : {}),
                ...(imageOutputFormat ? { output_format: imageOutputFormat } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                ...(background ? { background } : {}),
                response_format: "b64_json",
            },
            {
                headers: aiHeaders(requestConfig, "application/json"),
                signal: options?.signal,
            },
        );
        const images = parseImagePayload(response.data, imageOutputFormatMimeType(imageOutputFormat));
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

function usesJsonReferenceGeneration(config: ManagedAiConfig, referenceCount: number, hasMask: boolean) {
    if (!referenceCount || hasMask) return false;
    const model = config.model.toLowerCase();
    if (model.includes("seedream") || model.includes("doubao-seedream")) return true;
    try {
        return new URL(config.baseUrl).hostname.toLowerCase() === "ark.cn-beijing.volces.com";
    } catch {
        return false;
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions): Promise<RequestedImage[]> {
    const resolved = resolveImageRequestContext(config, references.length);
    const requestConfig = resolved.requestConfig;
    const effectiveConfig = resolved.config;
    const n = resolved.count;
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    if (isServerManagedConfig(requestConfig)) return requestServerImageJob(requestConfig, requestPrompt, references, mask, n, options);
    const script = resolveModelScript(effectiveConfig, resolved.selectedModel);
    if (script) {
        const resolution = effectiveConfig.quality === "auto" ? undefined : normalizeResolution(effectiveConfig.quality);
        const imageQuality = resolveSupportedImageQuality(requestConfig);
        const imageOutputFormat = resolveSupportedImageOutputFormat(requestConfig);
        const requestSize = resolveImageRequestSize(resolution, effectiveConfig.size, requestConfig.model);
        const background = normalizeBackground(effectiveConfig.background);
        const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, requestPrompt),
                images: refs,
                params: { size: requestSize, resolution, quality: imageQuality, outputFormat: imageOutputFormat, count: n, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        if (mask) throw new Error("Gemini 调用格式暂不支持蒙版编辑");
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (usesJsonReferenceGeneration(requestConfig, references.length, Boolean(mask))) {
        const resolution = normalizeResolution(effectiveConfig.quality);
        const imageQuality = resolveSupportedImageQuality(requestConfig);
        const imageOutputFormat = resolveSupportedImageOutputFormat(requestConfig);
        const requestSize = resolveImageRequestSize(resolution, effectiveConfig.size, requestConfig.model);
        const background = normalizeBackground(effectiveConfig.background);
        const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
        try {
            const response = await axios.post<ImageApiResponse>(
                aiApiUrl(requestConfig, "/images/generations"),
                {
                    model: requestConfig.model,
                    prompt: withSystemPrompt(requestConfig, requestPrompt),
                    image: refs,
                    ...(n > 1 ? { n } : {}),
                    ...(imageQuality ? { quality: imageQuality } : {}),
                    ...(imageOutputFormat ? { output_format: imageOutputFormat } : {}),
                    ...(requestSize ? { size: requestSize } : {}),
                    ...(background ? { background } : {}),
                    response_format: "b64_json",
                },
                { headers: aiHeaders(requestConfig, "application/json"), signal: options?.signal },
            );
            return parseImagePayload(response.data, imageOutputFormatMimeType(imageOutputFormat));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const resolution = normalizeResolution(effectiveConfig.quality);
    const imageQuality = resolveSupportedImageQuality(requestConfig);
    const imageOutputFormat = resolveSupportedImageOutputFormat(requestConfig);
    const requestSize = resolveImageRequestSize(resolution, effectiveConfig.size, requestConfig.model);
    const background = normalizeBackground(effectiveConfig.background);
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    if (n > 1) formData.set("n", String(n));
    formData.set("response_format", "b64_json");
    if (imageQuality) {
        formData.set("quality", imageQuality);
    }
    if (imageOutputFormat) {
        formData.set("output_format", imageOutputFormat);
    }
    if (requestSize) {
        formData.set("size", requestSize);
    }
    if (background) {
        formData.set("background", background);
    }
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));

    try {
        const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/edits"), formData, { headers: aiHeaders(requestConfig), signal: options?.signal });
        const images = parseImagePayload(response.data, imageOutputFormatMimeType(imageOutputFormat));
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    const script = resolveModelScript(config, config.model || config.textModel);
    if (script) {
        try {
            const answer = await runModelPlugin<string>({
                capability: "text",
                script,
                config: requestConfig,
                messages: withSystemMessage(requestConfig, messages),
                signal: options?.signal,
                onDelta,
            });
            const text = String(answer ?? "").trim() || "没有返回内容";
            if (text === "没有返回内容") onDelta(text);
            return text;
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        const result =
            openAiTextEndpoint(messages) === "/chat/completions"
                ? await requestStreamingChatCompletion(requestConfig, messages, onDelta, options)
                : await requestStreamingResponse(
                      requestConfig,
                      {
                          model: requestConfig.model,
                          input: toResponseInput(withSystemMessage(requestConfig, messages)),
                          ...(requestConfig.reasoningEffort === "auto" ? {} : { reasoning: { effort: requestConfig.reasoningEffort } }),
                      },
                      onDelta,
                      options,
                  );
        const answer = result.content || "没有返回内容";
        if (answer === "没有返回内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function fetchImageModels(config: ManagedAiConfig) {
    try {
        if (config.apiFormat === "gemini") {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }) });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(openAiApiUrl(config, "/models"), {
            headers: providerHeaders(config),
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    if (PUBLIC_MODE) {
        await saveServerChannel(channel);
        return fetchImageModels({ ...defaultConfig, baseUrl: channel.baseUrl, apiKey: "", apiFormat: channel.apiFormat, channelId: channel.id, serverManaged: true });
    }
    return fetchImageModels({ ...defaultConfig, baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

async function requestServerImageJob(
    requestConfig: ManagedAiConfig & { channelId: string; serverManaged: true },
    prompt: string,
    references: ReferenceImage[],
    mask: ReferenceImage | undefined,
    count: number,
    options?: RequestOptions,
): Promise<RequestedImage[]> {
    const expectedUserId = options?.expectedUserId ?? useUserStore.getState().user?.id ?? "";
    const capabilities = deriveImageModelCapabilities(requestConfig.model, requestConfig.apiFormat, requestConfig.baseUrl);
    const resolution = requestConfig.quality || "low";
    const imageQuality = resolveSupportedImageQuality(requestConfig);
    const imageOutputFormat = resolveSupportedImageOutputFormat(requestConfig);
    const size = normalizeImageSizeSelection(requestConfig.size);
    validateImageRequest(capabilities, { resolution, imageQuality: imageQuality || "auto", imageOutputFormat: imageOutputFormat || "auto", size, background: requestConfig.background || "", referenceCount: references.length, count });
    const referenceData = await Promise.all(references.map((reference) => imageToDataUrl(reference, expectedUserId)));
    const maskData = mask ? await imageToDataUrl(mask, expectedUserId) : undefined;
    const { job } = await submitImageJob({
        channelId: requestConfig.channelId,
        apiFormat: requestConfig.apiFormat,
        model: requestConfig.model,
        prompt: withSystemPrompt(requestConfig, prompt),
        count,
        quality: resolution,
        imageQuality,
        imageOutputFormat,
        size,
        background: normalizeBackground(requestConfig.background),
        references: referenceData,
        mask: maskData,
        source: options?.source,
    }, expectedUserId);
    options?.onJobCreated?.(job.id);
    const abort = () => void cancelServerJob(job.id, expectedUserId).catch(() => undefined);
    options?.signal?.addEventListener("abort", abort, { once: true });
    try {
        const completed = await waitForServerJob(job.id, { signal: options?.signal, expectedUserId });
        return (completed.result?.images || []).map((image) => ({
            id: image.id,
            dataUrl: image.dataUrl,
            width: image.width,
            height: image.height,
            bytes: image.bytes,
            durationMs: image.durationMs,
            mimeType: image.mimeType,
        }));
    } finally {
        options?.signal?.removeEventListener("abort", abort);
    }
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};
