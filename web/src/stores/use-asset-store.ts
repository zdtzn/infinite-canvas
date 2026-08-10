import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { runWithConcurrency } from "@/lib/async-pool";
import { localForageStorage } from "@/lib/localforage-storage";
import { deleteServerAssetLibraryItem, fetchServerAssetLibrary, replaceServerAssetLibrary, upsertServerAssetLibraryItem } from "@/services/server-api";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { mergeAssetRecords, planAssetLibraryHydration } from "./asset-library-sync";
import { normalizeAssetSource } from "./asset-source";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; thumbnailKey?: string; thumbnailUrl?: string; width: number; height: number; bytes: number; mimeType: string } };
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
    migratedUserIds: string[];
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
const ASSET_MIGRATION_CONCURRENCY = 4;
let assetLibraryMutation = Promise.resolve();
let assetHydrationVersion = 0;

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = Array.isArray(parsed.state.assets) ? parsed.state.assets : [];
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (storedAsset) => {
                const asset = normalizeAssetRecord(storedAsset);
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    const [dataUrl, thumbnailUrl] = await Promise.all([
                        asset.data.dataUrl && !asset.data.dataUrl.startsWith("blob:") ? asset.data.dataUrl : resolveImageUrl(asset.data.storageKey, asset.data.dataUrl),
                        asset.data.thumbnailUrl && !asset.data.thumbnailUrl.startsWith("blob:") ? asset.data.thumbnailUrl : resolveImageUrl(asset.data.thumbnailKey, asset.data.thumbnailUrl),
                    ]);
                    return {
                        ...asset,
                        coverUrl: thumbnailUrl || dataUrl,
                        data: { ...asset.data, dataUrl, thumbnailUrl },
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
            migratedUserIds: [],
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const item = normalizeAssetRecord({ ...asset, id, createdAt: now, updatedAt: now } as Asset);
                set((state) => ({ assets: [item, ...state.assets] }));
                const current = get();
                if (shouldSyncAssetLibrary(current)) enqueueAssetLibraryMutation(() => upsertServerAssetLibraryItem(item, current.ownerUserId));
                return id;
            },
            updateAsset: (id, patch) => {
                let updated: Asset | undefined;
                set((state) => ({
                    assets: state.assets.map((asset) => {
                        if (asset.id !== id) return asset;
                        updated = normalizeAssetRecord({ ...asset, ...patch, id, updatedAt: new Date().toISOString() } as Asset);
                        return updated;
                    }),
                }));
                const current = get();
                if (updated && shouldSyncAssetLibrary(current)) enqueueAssetLibraryMutation(() => upsertServerAssetLibraryItem(updated!, current.ownerUserId));
            },
            removeAsset: (id) => {
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    return { assets };
                });
                const current = get();
                if (shouldSyncAssetLibrary(current)) enqueueAssetLibraryMutation(() => deleteServerAssetLibraryItem(id, current.ownerUserId));
            },
            replaceAssets: (assets) => {
                const normalizedAssets = assets.map(normalizeAssetRecord);
                set({ assets: normalizedAssets });
                const current = get();
                if (shouldSyncAssetLibrary(current)) enqueueAssetLibraryMutation(() => replaceServerAssetLibrary(normalizedAssets, false, current.ownerUserId));
            },
            prepareForUser: (userId) => {
                if (!PUBLIC_MODE || !userId) return;
                const current = get();
                if (!current.ownerUserId) {
                    set({ ownerUserId: userId });
                    return;
                }
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
                const localAlreadyMigrated = current.migratedUserIds.includes(userId);
                if (!canMigrateLocal) set({ assets: [], ownerUserId: userId, serverHydrated: false });

                const remote = await fetchServerAssetLibrary(userId);
                if (requestVersion !== assetHydrationVersion) return;
                const remoteAssets = await Promise.all(remote.items.map(hydrateServerAsset));
                const migration = localAlreadyMigrated ? { prepared: [] as Asset[], failed: [] as Asset[] } : await prepareAssetsForServer(localAssets, userId);
                if (requestVersion !== assetHydrationVersion) return;
                const plan = planAssetLibraryHydration({
                    local: migration.prepared,
                    remote: remoteAssets,
                    remoteInitialized: remote.initialized,
                    localAlreadyMigrated,
                });
                const serverAssets = plan.writeServer ? await replaceServerAssetLibrary(plan.assets, false, userId).then((result) => Promise.all(result.items.map(hydrateServerAsset))) : plan.assets;
                const assets = mergeAssetRecords(migration.failed, serverAssets);
                if (requestVersion === assetHydrationVersion) {
                    set((state) => ({
                        assets,
                        ownerUserId: userId,
                        serverHydrated: true,
                        migratedUserIds: migration.failed.length || state.migratedUserIds.includes(userId) ? state.migratedUserIds : [...state.migratedUserIds, userId],
                    }));
                    if (migration.failed.length) reportAssetSyncError(new Error(`${migration.failed.length} 项旧资产暂未迁移，已保留在当前浏览器，下次打开时会继续尝试`));
                }
            },
            cleanupImages: (extra) => {
                void extra;
            },
        }),
        {
            name: ASSET_STORE_KEY,
            version: 3,
            storage: assetStorage,
            migrate: (persisted) => {
                const value = (persisted || {}) as Partial<AssetStore>;
                return {
                    ...value,
                    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : "",
                    serverHydrated: false,
                    migratedUserIds: Array.isArray(value.migratedUserIds) ? value.migratedUserIds.filter((item): item is string => typeof item === "string") : [],
                    assets: Array.isArray(value.assets) ? value.assets.map(normalizeAssetRecord) : [],
                } as AssetStore;
            },
            partialize: (state) => ({ ownerUserId: state.ownerUserId, migratedUserIds: state.migratedUserIds, assets: state.assets }) as StorageValue<AssetStore>["state"],
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
    asset = normalizeAssetRecord(asset);
    if (asset.kind === "image" && asset.data.storageKey) {
        const [dataUrl, thumbnailUrl] = await Promise.all([asset.data.dataUrl || resolveImageUrl(asset.data.storageKey), asset.data.thumbnailUrl || resolveImageUrl(asset.data.thumbnailKey)]);
        return { ...asset, coverUrl: thumbnailUrl || dataUrl, data: { ...asset.data, dataUrl, thumbnailUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey);
        return { ...asset, coverUrl: url, data: { ...asset.data, url } };
    }
    return asset;
}

function normalizeAssetRecord<T extends Asset>(asset: T): T {
    const source = normalizeAssetSource(asset.source);
    return source === asset.source ? asset : ({ ...asset, source } as T);
}

async function prepareAssetForServer(asset: Asset, expectedUserId: string): Promise<Asset> {
    if (asset.kind === "image" && !asset.data.storageKey) {
        const stored = await uploadImage(asset.data.dataUrl, { expectedUserId });
        return {
            ...asset,
            coverUrl: stored.thumbnailUrl || stored.url,
            data: {
                ...asset.data,
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                thumbnailKey: stored.thumbnailKey,
                thumbnailUrl: stored.thumbnailUrl,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            },
        };
    }
    if (asset.kind === "video" && !asset.data.storageKey) {
        const stored = await uploadMediaFile(asset.data.url, "video", expectedUserId);
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

async function prepareAssetsForServer(assets: Asset[], expectedUserId: string) {
    const results = await runWithConcurrency(assets, ASSET_MIGRATION_CONCURRENCY, async (asset) => {
        try {
            return { asset: await prepareAssetForServer(asset, expectedUserId), failed: false as const };
        } catch {
            return { asset, failed: true as const };
        }
    });
    return {
        prepared: results.filter((result) => !result.failed).map((result) => result.asset),
        failed: results.filter((result) => result.failed).map((result) => result.asset),
    };
}

function reportAssetSyncError(error: unknown) {
    if (typeof window === "undefined") return;
    const message = error instanceof Error ? error.message : "Asset library sync failed";
    window.dispatchEvent(new CustomEvent("canvas:asset-sync-error", { detail: { message } }));
}
