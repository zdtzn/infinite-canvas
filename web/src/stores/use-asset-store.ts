import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { localForageStorage } from "@/lib/localforage-storage";
import { deleteServerAssetLibraryItem, fetchServerAssetLibrary, replaceServerAssetLibrary, upsertServerAssetLibraryItem } from "@/services/server-api";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    ownerUserId: string;
    serverHydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    prepareForUser: (userId: string) => void;
    hydrateFromServer: (userId: string) => Promise<void>;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let assetLibraryMutation = Promise.resolve();
let assetHydrationVersion = 0;

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = Array.isArray(parsed.state.assets) ? parsed.state.assets : [];
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
                    return {
                        ...asset,
                        coverUrl: dataUrl,
                        data: { ...asset.data, dataUrl },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                return asset;
            }),
        );
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            ownerUserId: "",
            serverHydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const item = { ...asset, id, createdAt: now, updatedAt: now } as Asset;
                set((state) => ({ assets: [item, ...state.assets] }));
                if (shouldSyncAssetLibrary(get())) enqueueAssetLibraryMutation(() => upsertServerAssetLibraryItem(item));
                return id;
            },
            updateAsset: (id, patch) => {
                let updated: Asset | undefined;
                set((state) => ({
                    assets: state.assets.map((asset) => {
                        if (asset.id !== id) return asset;
                        updated = { ...asset, ...patch, id, updatedAt: new Date().toISOString() } as Asset;
                        return updated;
                    }),
                }));
                if (updated && shouldSyncAssetLibrary(get())) enqueueAssetLibraryMutation(() => upsertServerAssetLibraryItem(updated!));
            },
            removeAsset: (id) => {
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    return { assets };
                });
                if (shouldSyncAssetLibrary(get())) enqueueAssetLibraryMutation(() => deleteServerAssetLibraryItem(id));
            },
            replaceAssets: (assets) => {
                set({ assets });
                if (shouldSyncAssetLibrary(get())) enqueueAssetLibraryMutation(() => replaceServerAssetLibrary(assets));
            },
            prepareForUser: (userId) => {
                if (!PUBLIC_MODE || !userId) return;
                const current = get();
                if (current.ownerUserId && current.ownerUserId !== userId) {
                    assetHydrationVersion += 1;
                    set({ ownerUserId: userId, serverHydrated: false, assets: [] });
                }
            },
            hydrateFromServer: async (userId) => {
                if (!PUBLIC_MODE || !userId) return;
                const current = get();
                if (current.serverHydrated && current.ownerUserId === userId) return;
                const requestVersion = ++assetHydrationVersion;
                const canMigrateLocal = !current.ownerUserId || current.ownerUserId === userId;
                const localAssets = canMigrateLocal ? current.assets : [];
                if (!canMigrateLocal) set({ assets: [], ownerUserId: userId, serverHydrated: false });

                const remote = await fetchServerAssetLibrary();
                if (requestVersion !== assetHydrationVersion) return;
                if (remote.initialized) {
                    const assets = await Promise.all(remote.items.map(hydrateServerAsset));
                    if (requestVersion === assetHydrationVersion) set({ assets, ownerUserId: userId, serverHydrated: true });
                    return;
                }

                const prepared = await Promise.all(localAssets.map(prepareAssetForServer));
                if (requestVersion !== assetHydrationVersion) return;
                if (!prepared.length) {
                    set({ assets: [], ownerUserId: userId, serverHydrated: true });
                    return;
                }
                const migrated = await replaceServerAssetLibrary(prepared, true);
                const assets = await Promise.all(migrated.items.map(hydrateServerAsset));
                if (requestVersion === assetHydrationVersion) set({ assets, ownerUserId: userId, serverHydrated: true });
            },
            cleanupImages: (extra) => {
                void extra;
            },
        }),
        {
            name: ASSET_STORE_KEY,
            version: 2,
            storage: assetStorage,
            migrate: (persisted) => {
                const value = (persisted || {}) as Partial<AssetStore>;
                return {
                    ...value,
                    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : "",
                    serverHydrated: false,
                    assets: Array.isArray(value.assets) ? value.assets : [],
                } as AssetStore;
            },
            partialize: (state) => ({ ownerUserId: state.ownerUserId, assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);

function shouldSyncAssetLibrary(state: AssetStore) {
    return PUBLIC_MODE && state.serverHydrated && Boolean(state.ownerUserId);
}

function enqueueAssetLibraryMutation(operation: () => Promise<unknown>) {
    const pending = assetLibraryMutation.then(operation, operation);
    assetLibraryMutation = pending.then(
        () => undefined,
        (error) => {
            reportAssetSyncError(error);
        },
    );
}

async function hydrateServerAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey);
        return { ...asset, coverUrl: dataUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey);
        return { ...asset, coverUrl: url, data: { ...asset.data, url } };
    }
    return asset;
}

async function prepareAssetForServer(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && !asset.data.storageKey) {
        const stored = await uploadImage(asset.data.dataUrl);
        return {
            ...asset,
            coverUrl: stored.url,
            data: {
                ...asset.data,
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            },
        };
    }
    if (asset.kind === "video" && !asset.data.storageKey) {
        const stored = await uploadMediaFile(asset.data.url, "video");
        return {
            ...asset,
            coverUrl: stored.url,
            data: {
                ...asset.data,
                url: stored.url,
                storageKey: stored.storageKey,
                width: stored.width || asset.data.width,
                height: stored.height || asset.data.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            },
        };
    }
    return asset;
}

function reportAssetSyncError(error: unknown) {
    if (typeof window === "undefined") return;
    const message = error instanceof Error ? error.message : "Asset library sync failed";
    window.dispatchEvent(new CustomEvent("canvas:asset-sync-error", { detail: { message } }));
}
