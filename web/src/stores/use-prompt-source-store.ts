import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_PROMPT_SOURCES, createPromptSource, type PromptSource } from "@/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

const PROMPT_SOURCE_STORE_KEY = "infinite-canvas:prompt_source_store";

const defaultSchedule: PromptSourceSchedule = {
    intervalMinutes: 30,
    lastFetchedAt: "",
};

const defaultSourceIds = new Set(DEFAULT_PROMPT_SOURCES.map((source) => source.id));

export function isBuiltInPromptSource(source: Pick<PromptSource, "id">) {
    return defaultSourceIds.has(source.id);
}

function mergePromptSources(candidates: PromptSource[]) {
    const normalized = candidates.map((item) => createPromptSource(item));
    const seenSourceKeys = new Set<string>();
    const savedSources = normalized.filter((source) => {
        const key = source.githubUrl.trim().toLowerCase() || `id:${source.id}`;
        if (seenSourceKeys.has(key)) return false;
        seenSourceKeys.add(key);
        return true;
    });
    const savedIds = new Set(savedSources.map((source) => source.id));
    const savedGithubUrls = new Set(savedSources.map((source) => source.githubUrl.trim().toLowerCase()).filter(Boolean));
    const missingDefaults = DEFAULT_PROMPT_SOURCES.filter((source) => {
        const githubUrl = source.githubUrl.trim().toLowerCase();
        return !savedIds.has(source.id) && (!githubUrl || !savedGithubUrls.has(githubUrl));
    });
    return savedSources.length ? [...savedSources, ...missingDefaults] : DEFAULT_PROMPT_SOURCES;
}

export const PROMPT_SOURCE_INTERVAL_OPTIONS = [
    { label: "关闭定时", value: 0 },
    { label: "每 30 分钟", value: 30 },
    { label: "每 1 小时", value: 60 },
    { label: "每 6 小时", value: 360 },
    { label: "每 24 小时", value: 1440 },
];

type PromptSourceStore = {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    hydrated: boolean;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => void;
    setSharedSources: (sources: PromptSource[]) => void;
    removeSource: (id: string) => void;
    toggleSource: (id: string, enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
};

export const usePromptSourceStore = create<PromptSourceStore>()(
    persist(
        (set) => ({
            sources: DEFAULT_PROMPT_SOURCES,
            schedule: defaultSchedule,
            hydrated: false,
            addSource: () => {
                const source = createPromptSource();
                set((state) => ({ sources: [...state.sources, source] }));
                return source;
            },
            saveSource: (source) => set((state) => ({ sources: state.sources.map((item) => (item.id === source.id ? source : item)) })),
            setSharedSources: (sources) => set({ sources: mergePromptSources(sources) }),
            removeSource: (id) => set((state) => ({ sources: state.sources.filter((item) => item.id !== id) })),
            toggleSource: (id, enabled) => set((state) => ({ sources: state.sources.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            updateSchedule: (key, value) => set((state) => ({ schedule: { ...state.schedule, [key]: value } })),
        }),
        {
            name: PROMPT_SOURCE_STORE_KEY,
            version: 2,
            partialize: (state) => ({ sources: state.sources, schedule: state.schedule }),
            onRehydrateStorage: () => () => usePromptSourceStore.setState({ hydrated: true }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<PromptSourceStore>;
                return {
                    ...current,
                    sources: mergePromptSources(Array.isArray(persistedState.sources) ? persistedState.sources : []),
                    schedule: { ...defaultSchedule, ...(persistedState.schedule || {}) },
                    hydrated: true,
                };
            },
        },
    ),
);
