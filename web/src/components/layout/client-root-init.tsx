import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { App } from "antd";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useProjectServerSync } from "@/hooks/use-project-server-sync";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { fetchServerChannels, saveServerChannel, type ServerChannel } from "@/services/server-api";
import { useAssetStore } from "@/stores/use-asset-store";
import { createModelChannel, normalizeChannelModels, useConfigStore, type ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const syncedChannelUser = useRef("");
    const user = useUserStore((state) => state.user);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setPlatformChannels = useConfigStore((state) => state.setPlatformChannels);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const localAssetsHydrated = useAssetStore((state) => state.hydrated);
    const prepareAssetsForUser = useAssetStore((state) => state.prepareForUser);
    const hydrateAssetsFromServer = useAssetStore((state) => state.hydrateFromServer);

    usePromptSourceScheduler();
    useProjectServerSync();

    useLayoutEffect(() => {
        if (PUBLIC_MODE && user?.id) prepareAssetsForUser(user.id);
    }, [prepareAssetsForUser, user?.id]);

    useEffect(() => {
        if (!PUBLIC_MODE || !user?.id || !localAssetsHydrated) return;
        void hydrateAssetsFromServer(user.id).catch((error) => {
            message.error(error instanceof Error ? error.message : "个人资产同步失败");
        });
    }, [hydrateAssetsFromServer, localAssetsHydrated, message, user?.id]);

    useEffect(() => {
        const handleAssetSyncError = (event: Event) => {
            const detail = (event as CustomEvent<{ message?: string }>).detail;
            message.error(detail?.message || "个人资产同步失败");
        };
        const handleHistorySyncError = (event: Event) => {
            const detail = (event as CustomEvent<{ message?: string }>).detail;
            message.error(detail?.message || "生成记录同步失败");
        };
        window.addEventListener("canvas:asset-sync-error", handleAssetSyncError);
        window.addEventListener("canvas:generation-history-sync-error", handleHistorySyncError);
        return () => {
            window.removeEventListener("canvas:asset-sync-error", handleAssetSyncError);
            window.removeEventListener("canvas:generation-history-sync-error", handleHistorySyncError);
        };
    }, [message]);

    useEffect(() => {
        if (!PUBLIC_MODE || !user?.id || syncedChannelUser.current === user.id) return;
        let active = true;
        const localChannels = config.channels;
        syncedChannelUser.current = user.id;

        void (async () => {
            try {
                const channelsWithKeys = user.admin ? localChannels.filter((channel) => channel.apiKey.trim()) : [];
                if (channelsWithKeys.length) await Promise.all(channelsWithKeys.map(saveServerChannel));

                const response = await fetchServerChannels();
                let channels = response.items.map(toClientChannel);
                if (user.admin) {
                    const localById = new Map(localChannels.map((channel) => [channel.id, channel]));
                    const merged = channels.map((channel) => {
                        const local = localById.get(channel.id);
                        if (!local?.models.length) return channel;
                        return { ...channel, models: normalizeChannelModels([...local.models, ...channel.models]) };
                    });
                    const changed = merged.filter((channel, index) => !sameChannelModels(channel, channels[index]));
                    if (changed.length) await Promise.all(changed.map(saveServerChannel));
                    channels = merged;
                }

                if (!active) return;
                setPlatformChannels(channels);
                if (channelsWithKeys.length) message.success("浏览器中的 API Key 已迁移到服务端加密保存");
            } catch (error) {
                if (!active) return;
                syncedChannelUser.current = "";
                message.error(error instanceof Error ? error.message : "平台渠道同步失败");
            }
        })();

        return () => {
            active = false;
        };
        // The local channel snapshot is intentionally read only once per authenticated user.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message, setPlatformChannels, user?.admin, user?.id]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);

        if (PUBLIC_MODE && !user?.admin) {
            message.error("只有管理员可以导入或修改平台接口");
            return;
        }

        const firstChannel = config.channels[0];
        const imported = firstChannel ? { ...firstChannel, ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) } : createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" });
        void (async () => {
            try {
                if (PUBLIC_MODE && apiKey) await saveServerChannel(imported);
                const saved = PUBLIC_MODE && apiKey ? { ...imported, apiKey: "", credentialState: "saved" as const } : imported;
                updateConfig("channels", firstChannel ? config.channels.map((channel, index) => (index === 0 ? saved : channel)) : [saved]);
                if (baseUrl) updateConfig("baseUrl", baseUrl);
                updateConfig("apiKey", PUBLIC_MODE ? "" : apiKey || "");
                openConfigDialog(false);
                message.success(PUBLIC_MODE ? "接口配置已安全导入服务端" : "已导入本地直连配置");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "接口配置导入失败");
            }
        })();
    }, [config.channels, message, openConfigDialog, updateConfig, user?.admin]);

    return <>{children}</>;
}

function toClientChannel(channel: ServerChannel): ModelChannel {
    return createModelChannel({
        ...channel,
        apiKey: "",
        credentialState: channel.hasApiKey ? "saved" : "missing",
        models: channel.models,
    });
}

function sameChannelModels(left: ModelChannel, right: ModelChannel) {
    if (left.models.length !== right.models.length) return false;
    return left.models.every((model, index) => model.name === right.models[index]?.name && model.capability === right.models[index]?.capability);
}
