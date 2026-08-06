import { nanoid } from "nanoid";

import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import type { ChannelImageCapabilityConfig } from "@/stores/model-capabilities";
import { useUserStore } from "@/stores/use-user-store";

export type ManagedAiConfig = AiConfig & { channelId?: string; serverManaged?: boolean; imageCapabilities?: ChannelImageCapabilityConfig };

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

export function providerHeaders(config: ManagedAiConfig, contentType?: string, expectedUserId = useUserStore.getState().user?.id || "") {
    return {
        ...(isServerManagedConfig(config) ? {} : { Authorization: `Bearer ${config.apiKey}` }),
        ...(isServerManagedConfig(config) && expectedUserId ? { "X-Expected-User-Id": expectedUserId } : {}),
        ...(contentType ? { "Content-Type": contentType } : {}),
        "Idempotency-Key": nanoid(),
    };
}

export function geminiProviderHeaders(config: ManagedAiConfig, expectedUserId = useUserStore.getState().user?.id || "") {
    return {
        ...(isServerManagedConfig(config) ? {} : { "x-goog-api-key": config.apiKey }),
        ...(isServerManagedConfig(config) && expectedUserId ? { "X-Expected-User-Id": expectedUserId } : {}),
        "Content-Type": "application/json",
        "Idempotency-Key": nanoid(),
    };
}
