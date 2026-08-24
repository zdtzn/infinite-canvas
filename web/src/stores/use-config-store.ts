import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import type { ChannelImageCapabilityConfig } from "@/stores/model-capabilities";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    imageCapabilities?: ChannelImageCapabilityConfig;
};

export type ModelChannel = {
    id: string;
    name: string;
    sortOrder?: number;
    baseUrl: string;
    apiKey: string;
    credentialState?: "missing" | "saved";
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    /** Output resolution tier: low=1K, medium=2K, high=4K. */
    quality: string;
    /** Provider generation-quality setting, independent from output resolution. */
    imageQuality: string;
    /** Provider output encoding. "auto" lets the provider choose its default. */
    imageOutputFormat: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};

export type GenerationPreferences = {
    imageModel: string;
    videoModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    quality: string;
    imageQuality: string;
    imageOutputFormat: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    snapDimensionToStep: boolean;
};
export type ConfigTabKey = "channels" | "preferences" | "prompt-sources" | "webdav" | "local-storage" | "members";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export const CONFIG_PREFERENCE_OWNER_KEY = "infinite-canvas:config-preference-owner";
export const GENERATION_PREFERENCE_KEY_PREFIX = "infinite-canvas:generation-preferences:";
export const WEBDAV_PREFERENCE_KEY_PREFIX = "infinite-canvas:webdav-preferences:";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
let activeConfigPreferenceUserId = "";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: "默认渠道",
            sortOrder: 0,
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            credentialState: "missing",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "low",
    imageQuality: "auto",
    imageOutputFormat: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

const generationPreferenceConfigKeys = new Set<keyof AiConfig>([
    "imageModel",
    "videoModel",
    "audioModel",
    "audioVoice",
    "audioFormat",
    "audioSpeed",
    "audioInstructions",
    "videoSeconds",
    "vquality",
    "videoGenerateAudio",
    "videoWatermark",
    "quality",
    "imageQuality",
    "imageOutputFormat",
    "size",
    "background",
    "count",
    "canvasImageCount",
]);

export const defaultGenerationPreferences: GenerationPreferences = generationPreferencesFromConfig(defaultConfig, true);

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    snapDimensionToStep: boolean;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    setPlatformChannels: (channels: ModelChannel[]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    prepareAccountPreferences: (userId: string) => void;
    replaceGenerationPreferences: (preferences: GenerationPreferences) => void;
    setSnapDimensionToStep: (enabled: boolean) => void;
    clearSensitiveSession: () => void;
    clearAccountScopedPreferences: () => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
    replaceSystemPrompt: (value: string) => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    if (PUBLIC_MODE) return "";
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && (channel.credentialState === "saved" || channel.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            snapDimensionToStep: true,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => {
                    const config = { ...state.config, [key]: value };
                    if (generationPreferenceConfigKeys.has(key)) persistLocalGenerationPreferences(config, state.snapDimensionToStep);
                    return { config };
                }),
            setPlatformChannels: (channels) =>
                set((state) => {
                    const config = applyPlatformChannels(state.config, channels);
                    persistLocalGenerationPreferences(config, state.snapDimensionToStep);
                    return { config };
                }),
            updateWebdavConfig: (key, value) =>
                set((state) => {
                    const webdav = { ...state.webdav, [key]: value };
                    persistLocalWebdavPreferences(webdav);
                    return { webdav };
                }),
            prepareAccountPreferences: (userId) => {
                const nextUserId = userId.trim();
                const current = get();
                activeConfigPreferenceUserId = nextUserId;
                if (!nextUserId) {
                    set({
                        config: applyGenerationPreferences({ ...current.config, systemPrompt: "" }, defaultGenerationPreferences),
                        webdav: defaultWebdavSyncConfig,
                        snapDimensionToStep: defaultGenerationPreferences.snapDimensionToStep,
                    });
                    return;
                }

                const storage = preferenceStorage();
                const previousOwner = readStorageItem(storage, CONFIG_PREFERENCE_OWNER_KEY);
                let generationPreferences = readLocalGenerationPreferences(storage, nextUserId);
                let webdav = readLocalWebdavPreferences(storage, nextUserId);
                const canMigrateLegacy = !previousOwner || previousOwner === nextUserId;
                if (!generationPreferences && canMigrateLegacy) {
                    generationPreferences = generationPreferencesFromConfig(current.config, current.snapDimensionToStep);
                    writeLocalGenerationPreferences(storage, nextUserId, generationPreferences);
                }
                if (!webdav && canMigrateLegacy) {
                    webdav = sanitizeWebdavPreferences(current.webdav);
                    writeLocalWebdavPreferences(storage, nextUserId, webdav);
                }
                writeStorageItem(storage, CONFIG_PREFERENCE_OWNER_KEY, nextUserId);
                set({
                    config: applyGenerationPreferences({ ...current.config, systemPrompt: "" }, generationPreferences || defaultGenerationPreferences),
                    webdav: webdav || defaultWebdavSyncConfig,
                    snapDimensionToStep: generationPreferences?.snapDimensionToStep ?? defaultGenerationPreferences.snapDimensionToStep,
                });
            },
            replaceGenerationPreferences: (preferences) =>
                set((state) => {
                    const normalized = normalizeGenerationPreferences(preferences);
                    const config = applyGenerationPreferences(state.config, normalized);
                    writeLocalGenerationPreferences(preferenceStorage(), activeConfigPreferenceUserId, normalized);
                    return { config, snapDimensionToStep: normalized.snapDimensionToStep };
                }),
            setSnapDimensionToStep: (snapDimensionToStep) =>
                set((state) => {
                    persistLocalGenerationPreferences(state.config, snapDimensionToStep);
                    return { snapDimensionToStep };
                }),
            clearSensitiveSession: () =>
                set((state) => ({
                    config: {
                        ...state.config,
                        apiKey: "",
                        channels: state.config.channels.map((channel) => ({ ...channel, apiKey: "" })),
                    },
                    webdav: { ...state.webdav, password: "" },
                })),
            clearAccountScopedPreferences: () =>
                set((state) => ({
                    config: { ...state.config, systemPrompt: "" },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
            replaceSystemPrompt: (value) =>
                set((state) => ({
                    config: { ...state.config, systemPrompt: value },
                })),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: 4,
            partialize: (state) => ({
                config: {
                    ...state.config,
                    apiKey: "",
                    channels: state.config.channels.map((channel) => ({ ...channel, apiKey: "" })),
                },
                webdav: { ...state.webdav, password: "" },
                snapDimensionToStep: state.snapDimensionToStep,
            }),
            migrate: (persisted) => {
                const value = (persisted || {}) as Partial<ConfigStore>;
                const webdav = (value.webdav || {}) as Partial<WebdavSyncConfig>;
                return { ...value, webdav: { ...webdav, password: "" }, snapDimensionToStep: value.snapDimensionToStep !== false } as ConfigStore;
            },
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav, password: "" },
                    snapDimensionToStep: persistedState.snapDimensionToStep !== false,
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                        imageQuality: normalizeImageQuality(config.imageQuality),
                        imageOutputFormat: normalizeImageOutputFormat(config.imageOutputFormat),
                        size: normalizeImageSizeSelection(config.size),
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

export function generationPreferencesFromConfig(config: AiConfig, snapDimensionToStep: boolean): GenerationPreferences {
    return normalizeGenerationPreferences({
        imageModel: config.imageModel,
        videoModel: config.videoModel,
        audioModel: config.audioModel,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
        videoSeconds: config.videoSeconds,
        vquality: config.vquality,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        quality: config.quality,
        imageQuality: config.imageQuality,
        imageOutputFormat: config.imageOutputFormat,
        size: config.size,
        background: config.background,
        count: config.count,
        canvasImageCount: config.canvasImageCount,
        snapDimensionToStep,
    });
}

export function normalizeGenerationPreferences(value: unknown): GenerationPreferences {
    const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<GenerationPreferences>) : {};
    return {
        imageModel: optionalPreferenceString(source.imageModel, defaultConfig.imageModel, 300),
        videoModel: optionalPreferenceString(source.videoModel, defaultConfig.videoModel, 300),
        audioModel: optionalPreferenceString(source.audioModel, defaultConfig.audioModel, 300),
        audioVoice: preferenceString(source.audioVoice, defaultConfig.audioVoice, 80),
        audioFormat: preferenceString(source.audioFormat, defaultConfig.audioFormat, 32),
        audioSpeed: normalizePreferenceAudioSpeed(source.audioSpeed),
        audioInstructions: preferenceString(source.audioInstructions, "", 2_000, true),
        videoSeconds: normalizePreferenceVideoSeconds(source.videoSeconds),
        vquality: preferenceString(source.vquality, defaultConfig.vquality, 32),
        videoGenerateAudio: booleanPreferenceString(source.videoGenerateAudio, true),
        videoWatermark: booleanPreferenceString(source.videoWatermark, false),
        quality: enumPreference(source.quality, ["low", "medium", "high"], defaultConfig.quality),
        imageQuality: normalizeImageQuality(source.imageQuality),
        imageOutputFormat: normalizeImageOutputFormat(source.imageOutputFormat),
        size: preferenceString(source.size, defaultConfig.size, 32),
        background: enumPreference(source.background, ["", "transparent"], defaultConfig.background),
        count: normalizePreferenceCount(source.count, defaultConfig.count),
        canvasImageCount: normalizePreferenceCount(source.canvasImageCount, defaultConfig.canvasImageCount),
        snapDimensionToStep: source.snapDimensionToStep !== false,
    };
}

export function applyGenerationPreferences(config: AiConfig, value: GenerationPreferences): AiConfig {
    const preferences = normalizeGenerationPreferences(value);
    return {
        ...config,
        model: preferences.imageModel || config.model,
        imageModel: preferences.imageModel,
        videoModel: preferences.videoModel,
        audioModel: preferences.audioModel,
        audioVoice: preferences.audioVoice,
        audioFormat: preferences.audioFormat,
        audioSpeed: preferences.audioSpeed,
        audioInstructions: preferences.audioInstructions,
        videoSeconds: preferences.videoSeconds,
        vquality: preferences.vquality,
        videoGenerateAudio: preferences.videoGenerateAudio,
        videoWatermark: preferences.videoWatermark,
        quality: preferences.quality,
        imageQuality: preferences.imageQuality,
        imageOutputFormat: preferences.imageOutputFormat,
        size: preferences.size,
        background: preferences.background,
        count: preferences.count,
        canvasImageCount: preferences.canvasImageCount,
    };
}

export function generationPreferencesEqual(left: GenerationPreferences, right: GenerationPreferences) {
    return JSON.stringify(normalizeGenerationPreferences(left)) === JSON.stringify(normalizeGenerationPreferences(right));
}

export function readLocalGenerationPreferences(storage: Pick<Storage, "getItem"> | null | undefined, userId: string) {
    const value = readStorageItem(storage, generationPreferenceStorageKey(userId));
    if (!value) return null;
    try {
        return normalizeGenerationPreferences(JSON.parse(value));
    } catch {
        return null;
    }
}

export function writeLocalGenerationPreferences(storage: Pick<Storage, "setItem"> | null | undefined, userId: string, preferences: GenerationPreferences) {
    if (!userId) return;
    writeStorageItem(storage, generationPreferenceStorageKey(userId), JSON.stringify(normalizeGenerationPreferences(preferences)));
}

export function readLocalWebdavPreferences(storage: Pick<Storage, "getItem"> | null | undefined, userId: string) {
    const value = readStorageItem(storage, webdavPreferenceStorageKey(userId));
    if (!value) return null;
    try {
        return sanitizeWebdavPreferences(JSON.parse(value));
    } catch {
        return null;
    }
}

export function writeLocalWebdavPreferences(storage: Pick<Storage, "setItem"> | null | undefined, userId: string, webdav: WebdavSyncConfig) {
    if (!userId) return;
    writeStorageItem(storage, webdavPreferenceStorageKey(userId), JSON.stringify(sanitizeWebdavPreferences(webdav)));
}

function persistLocalGenerationPreferences(config: AiConfig, snapDimensionToStep: boolean) {
    writeLocalGenerationPreferences(preferenceStorage(), activeConfigPreferenceUserId, generationPreferencesFromConfig(config, snapDimensionToStep));
}

function persistLocalWebdavPreferences(webdav: WebdavSyncConfig) {
    writeLocalWebdavPreferences(preferenceStorage(), activeConfigPreferenceUserId, webdav);
}

function generationPreferenceStorageKey(userId: string) {
    return `${GENERATION_PREFERENCE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function webdavPreferenceStorageKey(userId: string) {
    return `${WEBDAV_PREFERENCE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function preferenceStorage() {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
}

function readStorageItem(storage: Pick<Storage, "getItem"> | null | undefined, key: string) {
    try {
        return storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function writeStorageItem(storage: Pick<Storage, "setItem"> | null | undefined, key: string, value: string) {
    try {
        storage?.setItem(key, value);
    } catch {
        // Browser privacy settings may disable local storage.
    }
}

function sanitizeWebdavPreferences(value: Partial<WebdavSyncConfig> | null | undefined): WebdavSyncConfig {
    return {
        url: preferenceString(value?.url, "", 2_000),
        username: preferenceString(value?.username, "", 300),
        password: "",
        directory: preferenceString(value?.directory, defaultWebdavSyncConfig.directory, 300),
        lastSyncedAt: preferenceString(value?.lastSyncedAt, "", 80),
    };
}

function preferenceString(value: unknown, fallback: string, maxLength: number, preserveWhitespace = false) {
    if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return fallback;
    const normalized = preserveWhitespace ? value : value.trim();
    return normalized || (preserveWhitespace ? "" : fallback);
}

function optionalPreferenceString(value: unknown, fallback: string, maxLength: number) {
    if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return fallback;
    return value.trim();
}

function enumPreference(value: unknown, options: readonly string[], fallback: string) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return options.includes(normalized) ? normalized : fallback;
}

function booleanPreferenceString(value: unknown, fallback: boolean) {
    if (value === "true" || value === true) return "true";
    if (value === "false" || value === false) return "false";
    return String(fallback);
}

function normalizePreferenceCount(value: unknown, fallback: string) {
    const count = Math.floor(Number(value));
    return Number.isFinite(count) ? String(Math.max(1, Math.min(15, count))) : fallback;
}

function normalizePreferenceVideoSeconds(value: unknown) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value));
    return Number.isFinite(seconds) ? String(Math.max(1, Math.min(20, seconds))) : defaultConfig.videoSeconds;
}

function normalizePreferenceAudioSpeed(value: unknown) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return defaultConfig.audioSpeed;
    return String(Math.max(0.25, Math.min(4, speed)));
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const imageCapabilities = typeof item === "string" || capability !== "image" ? undefined : normalizeChannelImageCapabilities(item.imageCapabilities);
        result.push({ name, capability, script, imageCapabilities });
    }
    return result;
}

export function normalizeChannelImageCapabilities(input: ChannelImageCapabilityConfig | undefined): ChannelImageCapabilityConfig | undefined {
    if (!input || !["auto", "conservative", "custom"].includes(input.mode)) return undefined;
    if (input.mode !== "custom") return { mode: input.mode };
    const ratios = Array.from(new Set((input.sizes || []).map((value) => String(value).trim()).filter((value) => /^\d{1,3}:\d{1,3}$/.test(value)))).slice(0, 30);
    const options = (values: string[] | undefined, allowed: string[], fallback: string[]) => {
        const normalized = Array.from(new Set((values || []).map((value) => String(value).trim().toLowerCase()).filter((value) => allowed.includes(value))));
        return normalized.length ? normalized : fallback;
    };
    const integer = (value: number | undefined, minimum: number, maximum: number, fallback: number) => {
        const parsed = Math.floor(Number(value));
        return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
    };
    return {
        mode: "custom",
        resolutions: options(input.resolutions, ["auto", "low", "medium", "high"], ["auto"]),
        generationQualities: options(input.generationQualities, ["auto", "low", "medium", "high", "standard", "hd"], ["auto"]),
        outputFormats: options(input.outputFormats, ["auto", "png", "jpeg", "webp"], ["auto"]),
        sizes: ratios.length ? ratios : ["1:1"],
        customSize: Boolean(input.customSize),
        transparentBackground: Boolean(input.transparentBackground),
        maxReferences: integer(input.maxReferences, 0, 16, 1),
        maxOutputs: integer(input.maxOutputs, 1, 10, 1),
    };
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        sortOrder: normalizeChannelSortOrder(channel?.sortOrder),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        credentialState: channel?.credentialState || (channel?.apiKey ? "saved" : "missing"),
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function applyPlatformChannels(config: AiConfig, input: ModelChannel[]): AiConfig {
    const channels = input.map((channel) =>
        createModelChannel({
            ...channel,
            apiKey: "",
            credentialState: "saved",
            models: channel.models,
        }),
    );
    const next = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: "",
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    const imageModel = pickPlatformModel(next, "image", config.imageModel);
    return {
        ...next,
        model: imageModel || normalizeModelOptionValue(config.model, channels),
        imageModel,
        videoModel: pickPlatformModel(next, "video", config.videoModel),
        textModel: pickPlatformModel(next, "text", config.textModel),
        audioModel: pickPlatformModel(next, "audio", config.audioModel),
    };
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return (
        matched ||
        config.channels[0] ||
        createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) })
    );
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const model = modelOptionName(value || config.model);
    return {
        ...config,
        model,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        channelId: channel.id,
        serverManaged: channel.credentialState === "saved",
        imageCapabilities: channel.models.find((item) => item.name === model)?.imageCapabilities,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            sortOrder: channel.sortOrder ?? index,
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                sortOrder: 0,
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? "gemini" : "openai";
}

function normalizeChannelSortOrder(value: unknown) {
    const sortOrder = Number(value);
    return Number.isInteger(sortOrder) && sortOrder >= 0 && sortOrder <= 100_000 ? sortOrder : undefined;
}

function normalizeImageQuality(value: unknown) {
    const quality = String(value || "auto")
        .trim()
        .toLowerCase();
    return ["auto", "low", "medium", "high", "standard", "hd"].includes(quality) ? quality : "auto";
}

function normalizeImageOutputFormat(value: unknown) {
    const format = String(value || "auto")
        .trim()
        .toLowerCase();
    return ["auto", "png", "jpeg", "webp"].includes(format) ? format : "auto";
}

export function normalizeImageSizeSelection(value: unknown) {
    const size = String(value || "").trim();
    return !size || size.toLowerCase() === "auto" ? "1:1" : size;
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
    return ["auto", "low", "medium", "high", "xhigh"].includes(String(value || "")) ? (value as ReasoningEffort) : "auto";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

function pickPlatformModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
