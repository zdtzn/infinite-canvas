import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { App } from "antd";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useProjectServerSync } from "@/hooks/use-project-server-sync";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { ensurePromptIndexReady } from "@/services/api/prompts";
import { fetchServerChannels, fetchServerPromptSources, fetchServerUserPreferences, saveServerChannel, saveServerPromptSource, saveServerUserPreferences, type ServerChannel } from "@/services/server-api";
import { useAssetStore } from "@/stores/use-asset-store";
import { isBuiltInPromptSource, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { createModelChannel, generationPreferencesEqual, generationPreferencesFromConfig, normalizeChannelModels, normalizeGenerationPreferences, useConfigStore, type GenerationPreferences, type ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const SYSTEM_PROMPT_OWNER_KEY = "infinite-canvas:system-prompt-owner";

export function ClientRootInit() {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const syncedChannelUser = useRef("");
    const syncedPromptSourceUser = useRef("");
    const syncedUserPreferencesUser = useRef("");
    const userPreferencesReady = useRef("");
    const [userPreferencesReadyUser, setUserPreferencesReadyUser] = useState("");
    const lastSyncedSystemPrompt = useRef<string | null>(null);
    const lastSyncedGenerationPreferences = useRef<GenerationPreferences | null>(null);
    const systemPromptSaveTimer = useRef<number | null>(null);
    const generationPreferencesSaveTimer = useRef<number | null>(null);
    const user = useUserStore((state) => state.user);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const replaceSystemPrompt = useConfigStore((state) => state.replaceSystemPrompt);
    const replaceGenerationPreferences = useConfigStore((state) => state.replaceGenerationPreferences);
    const snapDimensionToStep = useConfigStore((state) => state.snapDimensionToStep);
    const setPlatformChannels = useConfigStore((state) => state.setPlatformChannels);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const localAssetsHydrated = useAssetStore((state) => state.hydrated);
    const prepareAssetsForUser = useAssetStore((state) => state.prepareForUser);
    const hydrateAssetsFromServer = useAssetStore((state) => state.hydrateFromServer);
    const promptSources = usePromptSourceStore((state) => state.sources);
    const promptSourcesHydrated = usePromptSourceStore((state) => state.hydrated);
    const setSharedPromptSources = usePromptSourceStore((state) => state.setSharedSources);
    const generationPreferencesSignature = JSON.stringify(generationPreferencesFromConfig(config, snapDimensionToStep));

    usePromptSourceScheduler();
    useProjectServerSync(user?.id);

    useEffect(() => {
        if (!user?.id) {
            syncedUserPreferencesUser.current = "";
            userPreferencesReady.current = "";
            setUserPreferencesReadyUser("");
            lastSyncedSystemPrompt.current = null;
            lastSyncedGenerationPreferences.current = null;
            if (systemPromptSaveTimer.current !== null) window.clearTimeout(systemPromptSaveTimer.current);
            if (generationPreferencesSaveTimer.current !== null) window.clearTimeout(generationPreferencesSaveTimer.current);
            systemPromptSaveTimer.current = null;
            generationPreferencesSaveTimer.current = null;
            return;
        }
        if (!PUBLIC_MODE || syncedUserPreferencesUser.current === user.id) return;
        let active = true;
        const initialConfigState = useConfigStore.getState();
        const initialSystemPrompt = initialConfigState.config.systemPrompt;
        const initialGenerationPreferences = generationPreferencesFromConfig(initialConfigState.config, initialConfigState.snapDimensionToStep);
        syncedUserPreferencesUser.current = user.id;
        setUserPreferencesReadyUser("");

        void fetchServerUserPreferences(user.id)
            .then(async (preferences) => {
                if (!active) return;
                const currentConfigState = useConfigStore.getState();
                const currentSystemPrompt = currentConfigState.config.systemPrompt;
                const currentGenerationPreferences = generationPreferencesFromConfig(currentConfigState.config, currentConfigState.snapDimensionToStep);
                const ownedBy = readSystemPromptOwner();
                const systemPromptChangedDuringSync = currentSystemPrompt !== initialSystemPrompt;
                const generationPreferencesChangedDuringSync = !generationPreferencesEqual(currentGenerationPreferences, initialGenerationPreferences);
                let syncedSystemPrompt = currentSystemPrompt;
                let syncedGenerationPreferences = currentGenerationPreferences;
                let shouldSaveSystemPrompt = systemPromptChangedDuringSync;
                let shouldSaveGenerationPreferences = generationPreferencesChangedDuringSync;

                if (preferences.systemPromptConfigured && !systemPromptChangedDuringSync) {
                    replaceSystemPrompt(preferences.systemPrompt);
                    syncedSystemPrompt = preferences.systemPrompt;
                } else if (!preferences.systemPromptConfigured && !systemPromptChangedDuringSync && ownedBy && ownedBy !== user.id) {
                    replaceSystemPrompt("");
                    syncedSystemPrompt = "";
                } else if (!preferences.systemPromptConfigured && !currentSystemPrompt.trim()) {
                    syncedSystemPrompt = "";
                    shouldSaveSystemPrompt = systemPromptChangedDuringSync;
                } else if (!preferences.systemPromptConfigured) {
                    shouldSaveSystemPrompt = true;
                }

                if (preferences.generationPreferencesConfigured && preferences.generationPreferences && !generationPreferencesChangedDuringSync) {
                    syncedGenerationPreferences = normalizeGenerationPreferences(preferences.generationPreferences);
                    replaceGenerationPreferences(syncedGenerationPreferences);
                    shouldSaveGenerationPreferences = false;
                } else if (!preferences.generationPreferencesConfigured || !preferences.generationPreferences) {
                    shouldSaveGenerationPreferences = true;
                }

                if (shouldSaveSystemPrompt || shouldSaveGenerationPreferences) {
                    const systemPromptToSave = currentSystemPrompt;
                    const generationPreferencesToSave = currentGenerationPreferences;
                    const saved = await saveServerUserPreferences(
                        {
                            ...(shouldSaveSystemPrompt ? { systemPrompt: systemPromptToSave } : {}),
                            ...(shouldSaveGenerationPreferences ? { generationPreferences: generationPreferencesToSave } : {}),
                        },
                        user.id,
                    );
                    if (!active) return;
                    if (shouldSaveSystemPrompt) {
                        if (useConfigStore.getState().config.systemPrompt === systemPromptToSave) replaceSystemPrompt(saved.systemPrompt);
                        // If the user edited while this request was in flight, the ready-state
                        // effect below persists the newer local value.
                        syncedSystemPrompt = saved.systemPrompt;
                    }
                    if (shouldSaveGenerationPreferences && saved.generationPreferences) {
                        const savedGenerationPreferences = normalizeGenerationPreferences(saved.generationPreferences);
                        const latest = useConfigStore.getState();
                        const latestGenerationPreferences = generationPreferencesFromConfig(latest.config, latest.snapDimensionToStep);
                        if (generationPreferencesEqual(latestGenerationPreferences, generationPreferencesToSave)) replaceGenerationPreferences(savedGenerationPreferences);
                        syncedGenerationPreferences = savedGenerationPreferences;
                    }
                }
                lastSyncedSystemPrompt.current = syncedSystemPrompt;
                lastSyncedGenerationPreferences.current = syncedGenerationPreferences;
                writeSystemPromptOwner(user.id);
                userPreferencesReady.current = user.id;
                setUserPreferencesReadyUser(user.id);
            })
            .catch((error) => {
                if (!active) return;
                syncedUserPreferencesUser.current = "";
                userPreferencesReady.current = "";
                setUserPreferencesReadyUser("");
                message.error(error instanceof Error ? error.message : "用户偏好同步失败");
            });

        return () => {
            active = false;
        };
    }, [message, replaceGenerationPreferences, replaceSystemPrompt, user?.id]);

    useEffect(() => {
        if (!PUBLIC_MODE || !user?.id || userPreferencesReadyUser !== user.id || userPreferencesReady.current !== user.id || lastSyncedSystemPrompt.current === config.systemPrompt) return;
        if (systemPromptSaveTimer.current !== null) window.clearTimeout(systemPromptSaveTimer.current);
        let active = true;
        systemPromptSaveTimer.current = window.setTimeout(() => {
            systemPromptSaveTimer.current = null;
            const userId = user.id;
            const value = config.systemPrompt;
            void saveServerUserPreferences({ systemPrompt: value }, userId)
                .then((saved) => {
                    if (!active || userPreferencesReady.current !== userId || useUserStore.getState().user?.id !== userId) return;
                    lastSyncedSystemPrompt.current = saved.systemPrompt;
                    if (useConfigStore.getState().config.systemPrompt === value) replaceSystemPrompt(saved.systemPrompt);
                    writeSystemPromptOwner(userId);
                })
                .catch((error) => {
                    if (userPreferencesReady.current === userId) message.error(error instanceof Error ? error.message : "系统提示词保存失败");
                });
        }, 700);
        return () => {
            active = false;
            if (systemPromptSaveTimer.current !== null) window.clearTimeout(systemPromptSaveTimer.current);
            systemPromptSaveTimer.current = null;
        };
    }, [config.systemPrompt, message, replaceSystemPrompt, user?.id, userPreferencesReadyUser]);

    useEffect(() => {
        if (!PUBLIC_MODE || !user?.id || userPreferencesReadyUser !== user.id || userPreferencesReady.current !== user.id) return;
        const value = normalizeGenerationPreferences(JSON.parse(generationPreferencesSignature));
        if (lastSyncedGenerationPreferences.current && generationPreferencesEqual(lastSyncedGenerationPreferences.current, value)) return;
        if (generationPreferencesSaveTimer.current !== null) window.clearTimeout(generationPreferencesSaveTimer.current);
        let active = true;
        generationPreferencesSaveTimer.current = window.setTimeout(() => {
            generationPreferencesSaveTimer.current = null;
            const userId = user.id;
            void saveServerUserPreferences({ generationPreferences: value }, userId)
                .then((saved) => {
                    if (!active || userPreferencesReady.current !== userId || useUserStore.getState().user?.id !== userId || !saved.generationPreferences) return;
                    const persisted = normalizeGenerationPreferences(saved.generationPreferences);
                    lastSyncedGenerationPreferences.current = persisted;
                    const current = useConfigStore.getState();
                    const currentPreferences = generationPreferencesFromConfig(current.config, current.snapDimensionToStep);
                    if (generationPreferencesEqual(currentPreferences, value)) replaceGenerationPreferences(persisted);
                })
                .catch((error) => {
                    if (userPreferencesReady.current === userId) message.error(error instanceof Error ? error.message : "生成偏好保存失败");
                });
        }, 700);
        return () => {
            active = false;
            if (generationPreferencesSaveTimer.current !== null) window.clearTimeout(generationPreferencesSaveTimer.current);
            generationPreferencesSaveTimer.current = null;
        };
    }, [generationPreferencesSignature, message, replaceGenerationPreferences, user?.id, userPreferencesReadyUser]);

    useEffect(() => {
        if (!user?.id) {
            syncedPromptSourceUser.current = "";
            return;
        }
        if (!PUBLIC_MODE || !promptSourcesHydrated || syncedPromptSourceUser.current === user.id) return;
        let active = true;
        syncedPromptSourceUser.current = user.id;

        void (async () => {
            try {
                let response = await fetchServerPromptSources();
                if (user.admin && response.items.length === 0) {
                    const localCustomSources = promptSources.filter((source) => !isBuiltInPromptSource(source));
                    if (localCustomSources.length) {
                        await Promise.all(localCustomSources.map(saveServerPromptSource));
                        response = await fetchServerPromptSources();
                    }
                }
                if (active) {
                    setSharedPromptSources(response.items);
                    if (user.admin) void ensurePromptIndexReady();
                }
            } catch (error) {
                if (!active) return;
                syncedPromptSourceUser.current = "";
                message.error(error instanceof Error ? error.message : "提示词来源同步失败");
            }
        })();

        return () => {
            active = false;
        };
    }, [message, promptSources, promptSourcesHydrated, setSharedPromptSources, user?.admin, user?.id]);

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
                        return { ...channel, models: normalizeChannelModels([...channel.models, ...local.models]) };
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

    return null;
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
    return left.models.every((model, index) => {
        const other = right.models[index];
        return model.name === other?.name && model.capability === other.capability && JSON.stringify(model.imageCapabilities || null) === JSON.stringify(other.imageCapabilities || null);
    });
}

function readSystemPromptOwner() {
    try {
        return window.localStorage.getItem(SYSTEM_PROMPT_OWNER_KEY) || "";
    } catch {
        return "";
    }
}

function writeSystemPromptOwner(userId: string) {
    try {
        window.localStorage.setItem(SYSTEM_PROMPT_OWNER_KEY, userId);
    } catch {
        // A blocked localStorage must not prevent server preference sync.
    }
}
