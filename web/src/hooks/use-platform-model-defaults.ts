import { useEffect } from "react";
import { App } from "antd";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { fetchServerChannels, fetchServerModelDefaults } from "@/services/server-api";
import { createModelChannel, encodeChannelModel, modelMatchesCapability, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function usePlatformModelDefaults() {
    const userId = useUserStore((state) => state.user?.id);
    const { message } = App.useApp();

    useEffect(() => {
        if (!PUBLIC_MODE || !userId) return;
        let active = true;
        let loading = false;
        let reportedError = false;
        const isCurrentUser = () => active && useUserStore.getState().user?.id === userId;
        const refresh = async () => {
            if (!isCurrentUser() || loading || document.visibilityState === "hidden" || !navigator.onLine) return;
            loading = true;
            const previous = useConfigStore.getState().platformImageDefault;
            try {
                const { image } = await fetchServerModelDefaults(userId);
                if (!isCurrentUser()) return;
                const current = useConfigStore.getState();
                // An administrator may have saved a newer selection while this read was in flight.
                if (current.platformImageDefault !== previous && (!image || image.revision <= (current.platformImageDefault?.revision || 0))) return;
                if (image && !modelMatchesCapability(current.config, encodeChannelModel(image.channelId, image.model), "image")) {
                    const { items } = await fetchServerChannels();
                    if (!isCurrentUser()) return;
                    useConfigStore.getState().setPlatformChannels(items.map((channel) => createModelChannel({ ...channel, apiKey: "", credentialState: "saved" })));
                }
                if (isCurrentUser()) useConfigStore.getState().setPlatformImageDefault(image);
            } catch (error) {
                if (isCurrentUser() && !reportedError) {
                    reportedError = true;
                    message.error(userFacingErrorMessage(error, "暂时无法更新全站默认模型，稍后会自动重试"));
                }
            } finally {
                loading = false;
            }
        };
        const onRefresh = () => void refresh();
        const timer = window.setInterval(onRefresh, 15_000);
        window.addEventListener("focus", onRefresh);
        window.addEventListener("online", onRefresh);
        document.addEventListener("visibilitychange", onRefresh);
        onRefresh();
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener("focus", onRefresh);
            window.removeEventListener("online", onRefresh);
            document.removeEventListener("visibilitychange", onRefresh);
        };
    }, [message, userId]);
}
