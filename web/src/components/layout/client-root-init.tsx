import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { saveServerChannel } from "@/services/server-api";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useProjectServerSync } from "@/hooks/use-project-server-sync";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const migratedCredentials = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();
    useProjectServerSync();

    useEffect(() => {
        if (!PUBLIC_MODE || migratedCredentials.current) return;
        const channelsWithKeys = config.channels.filter((channel) => channel.apiKey.trim());
        if (!channelsWithKeys.length) {
            migratedCredentials.current = true;
            return;
        }
        migratedCredentials.current = true;
        void Promise.all(channelsWithKeys.map(saveServerChannel))
            .then(() => {
                updateConfig(
                    "channels",
                    config.channels.map((channel) => (channel.apiKey.trim() ? { ...channel, apiKey: "", credentialState: "saved" as const } : channel)),
                );
                updateConfig("apiKey", "");
                message.success("浏览器中的 API Key 已迁移到服务端加密保存");
            })
            .catch((error) => {
                migratedCredentials.current = false;
                message.error(error instanceof Error ? error.message : "API Key 迁移失败");
            });
    }, [config.channels, message, updateConfig]);

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
        const firstChannel = config.channels[0];
        const imported = firstChannel
            ? { ...firstChannel, ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) }
            : createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" });
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
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
