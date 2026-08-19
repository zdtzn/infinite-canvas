import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import { cloneColorSettings, colorSettingsEqual, createDefaultColorSettings, normalizeColorSettings } from "./settings";
import type { ColorAlchemyDocument, ColorAlchemyReference, ColorAlchemySource, ColorAnalysis, ColorSettings } from "./types";

type ColorAlchemyStore = {
    hydrated: boolean;
    ownerUserId: string;
    activeDocumentId: string | null;
    documents: ColorAlchemyDocument[];
    prepareForUser: (userId: string) => void;
    mergeDocuments: (documents: ColorAlchemyDocument[]) => void;
    removeDocuments: (ids: string[]) => void;
    openSource: (source: ColorAlchemySource) => string;
    selectDocument: (id: string) => void;
    removeDocument: (id: string) => void;
    setAnalysis: (id: string, analysis: ColorAnalysis) => void;
    setReference: (id: string, reference?: ColorAlchemyReference) => void;
    replaceSettings: (id: string, settings: ColorSettings, commit?: boolean) => void;
    commitSettings: (id: string) => void;
    undo: (id: string) => void;
    redo: (id: string) => void;
    reset: (id: string) => void;
};

const STORE_KEY = "infinite-canvas:color-alchemy";
const MAX_DOCUMENTS = 12;
const MAX_HISTORY = 50;

const storage: PersistStorage<ColorAlchemyStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        return value ? (JSON.parse(value) as StorageValue<ColorAlchemyStore>) : null;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useColorAlchemyStore = create<ColorAlchemyStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            ownerUserId: "",
            activeDocumentId: null,
            documents: [],
            prepareForUser: (userId) => {
                const nextUserId = userId.trim();
                const current = get();
                if (current.ownerUserId === nextUserId) return;
                if (!current.ownerUserId && nextUserId) {
                    set({ ownerUserId: nextUserId });
                    return;
                }
                set({ ownerUserId: nextUserId, activeDocumentId: null, documents: [] });
            },
            mergeDocuments: (documents) =>
                set((state) => {
                    const merged = new Map<string, ColorAlchemyDocument>();
                    for (const document of state.documents) merged.set(document.id, document);
                    for (const document of documents) {
                        const normalized = normalizeDocument(document);
                        if (!normalized) continue;
                        const current = merged.get(normalized.id);
                        if (!current || Date.parse(normalized.updatedAt) >= Date.parse(current.updatedAt)) merged.set(normalized.id, normalized);
                    }
                    const nextDocuments = Array.from(merged.values())
                        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
                        .slice(0, MAX_DOCUMENTS);
                    return {
                        documents: nextDocuments,
                        activeDocumentId: nextDocuments.some((document) => document.id === state.activeDocumentId)
                            ? state.activeDocumentId
                            : nextDocuments[0]?.id || null,
                    };
                }),
            removeDocuments: (ids) => {
                const removed = new Set(ids);
                if (!removed.size) return;
                set((state) => {
                    const documents = state.documents.filter((document) => !removed.has(document.id));
                    return {
                        documents,
                        activeDocumentId: removed.has(state.activeDocumentId || "") ? documents[0]?.id || null : state.activeDocumentId,
                    };
                });
            },
            openSource: (source) => {
                const current = get();
                const now = new Date().toISOString();
                const settings = createDefaultColorSettings();
                const document: ColorAlchemyDocument = {
                    id: nanoid(),
                    source,
                    settings,
                    history: [cloneColorSettings(settings)],
                    historyIndex: 0,
                    createdAt: now,
                    updatedAt: now,
                };
                set({ activeDocumentId: document.id, documents: [document, ...current.documents].slice(0, MAX_DOCUMENTS) });
                return document.id;
            },
            selectDocument: (id) => set((state) => ({ activeDocumentId: state.documents.some((document) => document.id === id) ? id : state.activeDocumentId })),
            removeDocument: (id) =>
                set((state) => {
                    const documents = state.documents.filter((document) => document.id !== id);
                    return { documents, activeDocumentId: state.activeDocumentId === id ? documents[0]?.id || null : state.activeDocumentId };
                }),
            setAnalysis: (id, analysis) => updateDocument(set, id, (document) => ({ ...document, analysis })),
            setReference: (id, reference) => updateDocument(set, id, (document) => ({ ...document, reference })),
            replaceSettings: (id, settings, commit = false) => {
                const normalized = normalizeColorSettings(settings);
                updateDocument(set, id, (document) => {
                    if (!commit) return { ...document, settings: normalized };
                    if (colorSettingsEqual(document.settings, normalized) && colorSettingsEqual(document.history[document.historyIndex], normalized)) return document;
                    const history = [...document.history.slice(0, document.historyIndex + 1), cloneColorSettings(normalized)].slice(-MAX_HISTORY);
                    return { ...document, settings: normalized, history, historyIndex: history.length - 1 };
                });
            },
            commitSettings: (id) =>
                updateDocument(set, id, (document) => {
                    if (colorSettingsEqual(document.history[document.historyIndex], document.settings)) return document;
                    const history = [...document.history.slice(0, document.historyIndex + 1), cloneColorSettings(document.settings)].slice(-MAX_HISTORY);
                    return { ...document, history, historyIndex: history.length - 1 };
                }),
            undo: (id) =>
                updateDocument(set, id, (document) => {
                    const current = document.history[document.historyIndex];
                    if (!colorSettingsEqual(current, document.settings)) return { ...document, settings: cloneColorSettings(current) };
                    const historyIndex = Math.max(0, document.historyIndex - 1);
                    return historyIndex === document.historyIndex ? document : { ...document, historyIndex, settings: cloneColorSettings(document.history[historyIndex]) };
                }),
            redo: (id) =>
                updateDocument(set, id, (document) => {
                    const historyIndex = Math.min(document.history.length - 1, document.historyIndex + 1);
                    return historyIndex === document.historyIndex ? document : { ...document, historyIndex, settings: cloneColorSettings(document.history[historyIndex]) };
                }),
            reset: (id) => {
                const settings = createDefaultColorSettings();
                get().replaceSettings(id, settings, true);
            },
        }),
        {
            name: STORE_KEY,
            version: 2,
            storage,
            migrate: (persisted) => {
                const value = (persisted || {}) as Partial<ColorAlchemyStore>;
                const documents = Array.isArray(value.documents)
                    ? value.documents
                          .map(normalizeDocument)
                          .filter((document): document is ColorAlchemyDocument => Boolean(document))
                          .slice(0, MAX_DOCUMENTS)
                    : [];
                const activeDocumentId = documents.some((document) => document.id === value.activeDocumentId) ? value.activeDocumentId! : documents[0]?.id || null;
                return {
                    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : "",
                    activeDocumentId,
                    documents,
                } as ColorAlchemyStore;
            },
            partialize: (state) => ({ ownerUserId: state.ownerUserId, activeDocumentId: state.activeDocumentId, documents: state.documents }) as StorageValue<ColorAlchemyStore>["state"],
            onRehydrateStorage: () => () => useColorAlchemyStore.setState({ hydrated: true }),
        },
    ),
);

export function prepareColorAlchemyForUser(userId: string) {
    useColorAlchemyStore.getState().prepareForUser(userId);
}

function updateDocument(set: (updater: (state: ColorAlchemyStore) => Partial<ColorAlchemyStore>) => void, id: string, transform: (document: ColorAlchemyDocument) => ColorAlchemyDocument) {
    set((state) => ({
        documents: state.documents.map((document) => {
            if (document.id !== id) return document;
            const updatedAt = new Date(Math.max(Date.now(), Date.parse(document.updatedAt) + 1)).toISOString();
            return { ...transform(document), updatedAt };
        }),
    }));
}

function normalizeDocument(value: unknown): ColorAlchemyDocument | null {
    if (!value || typeof value !== "object") return null;
    const document = value as Partial<ColorAlchemyDocument>;
    if (!document.id || !document.source?.key || !document.source.url) return null;
    const settings = normalizeColorSettings(document.settings);
    const history = Array.isArray(document.history) && document.history.length ? document.history.map(normalizeColorSettings).slice(-MAX_HISTORY) : [cloneColorSettings(settings)];
    const historyIndex = Math.min(history.length - 1, Math.max(0, Number.isInteger(document.historyIndex) ? Number(document.historyIndex) : history.length - 1));
    const now = new Date().toISOString();
    return {
        id: document.id,
        source: document.source,
        reference: document.reference,
        settings,
        history,
        historyIndex,
        analysis: document.analysis,
        createdAt: document.createdAt || now,
        updatedAt: document.updatedAt || now,
    };
}
