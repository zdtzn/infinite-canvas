import { createModelChannel, type ModelChannel } from "@/stores/use-config-store";

export function normalizeImportedBaseUrl(value: string) {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error("Base URL 无效，请填写完整的 HTTP(S) 地址");
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Base URL 不能包含凭据、查询参数或片段");
    return url.toString().replace(/\/+$/, "");
}

export function planChannelImport(channels: ModelChannel[], baseUrl: string | null, apiKey: string | null) {
    if (!baseUrl?.trim()) throw new Error("导入接口必须提供 Base URL，现有渠道未修改");
    const normalized = normalizeImportedBaseUrl(baseUrl);
    const existing = channels.find((channel) => {
        try {
            return normalizeImportedBaseUrl(channel.baseUrl) === normalized;
        } catch {
            return false;
        }
    });
    const channel = existing ? { ...existing, baseUrl: normalized, ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}) } : createModelChannel({ name: new URL(normalized).hostname, baseUrl: normalized, apiKey: apiKey?.trim() || "" });
    return { channel, created: !existing };
}
