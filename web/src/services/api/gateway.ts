import { nanoid } from "nanoid";

import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";

export type ManagedAiConfig = AiConfig & { channelId?: string; serverManaged?: boolean };

export function isServerManagedConfig(config: Pick<ManagedAiConfig, "channelId" | "serverManaged">): config is ManagedAiConfig & { channelId: string; serverManaged: true } {
    return Boolean(config.serverManaged && config.channelId);
}

export function openAiApiUrl(config: ManagedAiConfig, path: string) {
    return isServerManagedConfig(config) ? `/api/ai/${encodeURIComponent(config.channelId)}/openai/${path.replace(/^\/+/, "")}` : buildApiUrl(config.baseUrl, path);
}

export function geminiApiBase(config: ManagedAiConfig) {
    if (isServerManagedConfig(config)) return `/api/ai/${encodeURIComponent(config.channelId)}/gemini`;
    const normalized = config.baseUrl.trim().replace(/\/+$/, "");
    return /\/(?:v1|v1beta)$/i.test(normalized) ? normalized : `${normalized}/v1beta`;
}

export function providerHeaders(config: ManagedAiConfig, contentType?: string) {
    return {
        ...(isServerManagedConfig(config) ? {} : { Authorization: `Bearer ${config.apiKey}` }),
        ...(contentType ? { "Content-Type": contentType } : {}),
        "Idempotency-Key": nanoid(),
    };
}

export function geminiProviderHeaders(config: ManagedAiConfig) {
    return {
        ...(isServerManagedConfig(config) ? {} : { "x-goog-api-key": config.apiKey }),
        "Content-Type": "application/json",
        "Idempotency-Key": nanoid(),
    };
}
