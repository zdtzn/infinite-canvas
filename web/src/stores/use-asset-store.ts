import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import localforage from "localforage";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { runWithConcurrency } from "@/lib/async-pool";
import "@/lib/localforage-storage";
import { deleteServerAssetLibraryItem, fetchServerAssetLibrary, replaceServerAssetLibrary, upsertServerAssetLibraryItem } from "@/services/server-api";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { mergeAssetRecords, planAssetLibraryHydration, shouldFetchCompleteServerLibraryForMigration } from "./asset-library-sync";
import { normalizeAssetSource } from "./asset-source";
import { ASSET_SYNC_MAX_ATTEMPTS, ASSET_SYNC_SUCCESS_EVENT, assetSyncRetryDelay, preservePendingAssets, queueAssetSync, type AssetSyncEntry, type AssetSyncStatus, type AssetSyncSuccessDetail } from "./asset-sync-queue";
import { useUserStore } from "./use-user-store";

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
    category?: string;
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
    serverAssetPage: number;
    serverAssetPageSize: number;
    serverAssetHasMore: boolean;
    serverAssetLoading: boolean;
    migratedUserIds: string[];
    assets: Asset[];
    syncOutbox: AssetSyncEntry[];
    syncingAssetId: string;
    syncStorageError: string;
    flushAssetSync: () => Promise<void>;
    retryAssetSync: (id?: string) => Promise<void>;
    getAssetSyncStatus: (id: string) => AssetSyncStatus;
    waitForAssetLocalSave: (id: string) => Promise<AssetSyncStatus>;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    saveAsset: (asset: Asset) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => void;
    prepareForUser: (userId: string) => void;
    hydrateFromServer: (userId: string) => Promise<void>;
    loadMoreServerAssets: () => Promise<void>;
    loadAllServerAssets: () => Promise<void>;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
const ASSET_MIGRATION_CONCURRENCY = 4;
let assetLibraryMutation = Promise.resolve();
let assetHydrationVersion = 0;
let serverAssetMoreTask: Promise<void> | null = null;
let assetPersistenceTask = Promise.resolve();
let assetSyncTask: Promise<void> | null = null;
const assetDeleteTasks = new Map<string, Promise<void>>();
let assetRetryTimer: ReturnType<typeof setTimeout> | undefined;
let preparedAssetUserId: string | undefined;

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        await assetPersistenceTask.catch(() => undefined);
        const value = typeof window === "undefined" ? null : await localforage.getItem<string>(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = Array.isArray(parsed.state.assets) ? parsed.state.assets : [];
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (storedAsset) => {
                const asset = normalizeAssetRecord(storedAsset);
                if (PUBLIC_MODE && asset.kind === "video" && asset.data.storageKey) return asset;
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (PUBLIC_MODE && asset.data.storageKey) return asset;
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
    setItem: (name, value) => {
        // A failed read must not overwrite an unread outbox with an empty snapshot.
        if (!useAssetStore.getState().hydrated) return Promise.resolve();
        const serialized = JSON.stringify(value);
        // Serialize snapshots: a late write must never restore an already deleted outbox entry.
        assetPersistenceTask = assetPersistenceTask
            .catch(() => undefined)
            .then(async () => {
                if (typeof window !== "undefined") await localforage.setItem(name, serialized);
            });
        return assetPersistenceTask.then(
            () => {
                if (useAssetStore.getState().syncStorageError) useAssetStore.setState({ syncStorageError: "" });
            },
            () => {
                const message = "本机保存失败，请释放浏览器存储空间后重试，暂勿关闭页面";
                if (useAssetStore.getState().syncStorageError !== message) useAssetStore.setState({ syncStorageError: message });
            },
        );
    },
    removeItem: async (name) => {
        if (typeof window !== "undefined") await localforage.removeItem(name);
    },
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            ownerUserId: "",
            serverHydrated: false,
            serverAssetPage: 0,
            serverAssetPageSize: 60,
            serverAssetHasMore: false,
            serverAssetLoading: false,
            migratedUserIds: [],
            assets: [],
            syncOutbox: [],
            syncingAssetId: "",
            syncStorageError: "",
            flushAssetSync: flushAssetSyncOutbox,
            retryAssetSync: async (id) => {
                if (!get().hydrated) await useAssetStore.persist.rehydrate();
                const current = get();
                if (!isActiveAssetOwner(current.ownerUserId)) return;
                set((state) => ({ syncOutbox: state.syncOutbox.map((entry) => (entry.userId === current.ownerUserId && (!id || entry.assetId === id) ? { ...entry, status: "pending", attempts: 0, retryAt: 0, error: undefined } : entry)) }));
                await flushAssetSyncOutbox();
            },
            getAssetSyncStatus: (id) => {
                const state = get();
                if (!PUBLIC_MODE) return "local";
                return state.syncOutbox.find((entry) => entry.userId === state.ownerUserId && entry.assetId === id)?.status || "synced";
            },
            waitForAssetLocalSave: async (id) => {
                const userId = get().ownerUserId;
                await assetPersistenceTask;
                if (get().ownerUserId !== userId || (PUBLIC_MODE && !isActiveAssetOwner(userId)) || !get().assets.some((asset) => asset.id === id)) throw new Error("素材所属账号已变更或素材已删除");
                return get().getAssetSyncStatus(id);
            },
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                return get().saveAsset({ ...asset, id, createdAt: now, updatedAt: now } as Asset);
            },
            // Accept complete records from remote pages, including items not in the
            // current cache. Every writer shares one revision-aware upsert path.
            saveAsset: (asset) => {
                assertAssetOwnerReady();
                const { id } = asset;
                if (!id) throw new Error("素材标识不能为空");
                const current = get();
                if (current.syncOutbox.some((entry) => entry.userId === current.ownerUserId && entry.assetId === id && entry.operation === "delete")) throw new Error("该素材正在删除，请等待删除完成或重试删除");
                const item = normalizeAssetRecord(asset);
                set((state) => ({
                    assets: [item, ...state.assets.filter((existing) => existing.id !== id)],
                    syncOutbox: PUBLIC_MODE ? queueAssetSync(state.syncOutbox, { userId: state.ownerUserId, assetId: id, asset: item, operation: "upsert" }) : state.syncOutbox,
                }));
                void flushAssetSyncOutbox();
                return id;
            },
            updateAsset: (id, patch) => {
                assertAssetOwnerReady();
                const current = get();
                const asset = current.assets.find((item) => item.id === id);
                if (!asset) return;
                get().saveAsset({ ...asset, ...patch, id, updatedAt: new Date().toISOString() } as Asset);
            },
            removeAsset: async (id) => {
                assertAssetOwnerReady();
                const current = get();
                if (!PUBLIC_MODE) {
                    set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
                    return;
                }
                const taskKey = JSON.stringify([current.ownerUserId, id]);
                const existingTask = assetDeleteTasks.get(taskKey);
                if (existingTask) return existingTask;
                // Persist the delete intent before waiting for an in-flight upsert. A reload
                // after a lost DELETE response must retry DELETE, never replay the old PUT.
                const outbox = queueAssetSync(current.syncOutbox, { userId: current.ownerUserId, assetId: id, asset: current.assets.find((asset) => asset.id === id), operation: "delete" });
                const entry = outbox[outbox.length - 1];
                set({ syncOutbox: outbox });
                const task = enqueueAssetLibraryMutation(async () => {
                    await syncAssetEntry(entry);
                    if (!isActiveAssetOwner(current.ownerUserId)) throw new Error("账号已切换，请在原账号确认删除结果");
                }).finally(() => {
                    if (assetDeleteTasks.get(taskKey) === task) assetDeleteTasks.delete(taskKey);
                    scheduleAssetSyncRetry();
                });
                assetDeleteTasks.set(taskKey, task);
                return task;
            },
            replaceAssets: (assets) => {
                assertAssetOwnerReady();
                const current = get();
                const normalizedAssets = preservePendingAssets(assets.map(normalizeAssetRecord), current.syncOutbox, current.ownerUserId);
                let syncOutbox = current.syncOutbox;
                if (PUBLIC_MODE) {
                    // WebDAV imports are merged records. Send them through the same outbox;
                    // a stale import must not override an outstanding delete intent.
                    const deleting = new Set(syncOutbox.filter((entry) => entry.userId === current.ownerUserId && entry.operation === "delete").map((entry) => entry.assetId));
                    for (const asset of normalizedAssets) {
                        if (!deleting.has(asset.id)) syncOutbox = queueAssetSync(syncOutbox, { userId: current.ownerUserId, assetId: asset.id, asset, operation: "upsert" });
                    }
                }
                set({ assets: normalizedAssets, syncOutbox, serverAssetHasMore: false, serverAssetPage: 0, serverAssetLoading: false });
                void flushAssetSyncOutbox();
            },
            prepareForUser: (userId) => {
                if (!PUBLIC_MODE) return;
                preparedAssetUserId = userId;
                const current = get();
                if (!current.hydrated) return;
                if (current.ownerUserId !== userId) {
                    assetHydrationVersion += 1;
                    clearTimeout(assetRetryTimer);
                    serverAssetMoreTask = null;
                    set({
                        ownerUserId: userId,
                        serverHydrated: false,
                        serverAssetPage: 0,
                        serverAssetHasMore: false,
                        serverAssetLoading: false,
                        syncingAssetId: "",
                        assets: userId ? preservePendingAssets(current.ownerUserId ? [] : current.assets, current.syncOutbox, userId) : [],
                    });
                }
            },
            hydrateFromServer: async (userId) => {
                if (!PUBLIC_MODE || !userId || useUserStore.getState().user?.id !== userId || !get().hydrated) return;
                get().prepareForUser(userId);
                await enqueueAssetLibraryMutation(async () => {
                    if (!isActiveAssetOwner(userId)) return;
                    const current = get();
                    if (current.serverHydrated && current.ownerUserId === userId) return;
                    const requestVersion = ++assetHydrationVersion;
                    const canMigrateLocal = !current.ownerUserId || current.ownerUserId === userId;
                    const pendingIds = new Set(current.syncOutbox.filter((entry) => entry.userId === userId).map((entry) => entry.assetId));
                    const localAssets = canMigrateLocal ? current.assets.filter((asset) => !pendingIds.has(asset.id)) : [];
                    const localAlreadyMigrated = current.migratedUserIds.includes(userId);
                    if (!canMigrateLocal) set({ assets: [], ownerUserId: userId, serverHydrated: false, serverAssetPage: 0, serverAssetHasMore: false, serverAssetLoading: false });

                    const remote = await fetchServerAssetLibrary(userId, { page: 1, pageSize: 60 });
                    if (requestVersion !== assetHydrationVersion) return;
                    const migration = localAlreadyMigrated ? { prepared: [] as Asset[], failed: [] as Asset[] } : await prepareAssetsForServer(localAssets, userId);
                    if (requestVersion !== assetHydrationVersion) return;
                    const remoteItems = shouldFetchCompleteServerLibraryForMigration({
                        localCount: migration.prepared.length,
                        remoteInitialized: remote.initialized,
                        localAlreadyMigrated,
                        remoteHasMore: Boolean(remote.hasMore),
                    })
                        ? await fetchAllServerAssets(userId, remote, requestVersion)
                        : remote.items;
                    if (!remoteItems || requestVersion !== assetHydrationVersion) return;
                    const remoteAssets = await Promise.all(remoteItems.map(hydrateServerAsset));
                    const plan = planAssetLibraryHydration({
                        local: migration.prepared,
                        remote: remoteAssets,
                        remoteInitialized: remote.initialized,
                        localAlreadyMigrated,
                    });
                    if (requestVersion !== assetHydrationVersion || !isActiveAssetOwner(userId)) return;
                    const serverAssets = plan.writeServer ? await replaceServerAssetLibrary(plan.assets, false, userId).then((result) => Promise.all(result.items.map(hydrateServerAsset))) : plan.assets;
                    const assets = mergeAssetRecords(migration.failed, serverAssets);
                    const loadedCompleteLibrary = plan.writeServer && remoteItems.length > remote.items.length;
                    if (requestVersion === assetHydrationVersion && isActiveAssetOwner(userId)) {
                        set((state) => ({
                            assets: preservePendingAssets(assets, state.syncOutbox, userId),
                            ownerUserId: userId,
                            serverHydrated: true,
                            serverAssetPage: remote.page || 1,
                            serverAssetPageSize: remote.pageSize || 60,
                            serverAssetHasMore: loadedCompleteLibrary ? false : Boolean(remote.hasMore),
                            serverAssetLoading: false,
                            migratedUserIds: migration.failed.length || state.migratedUserIds.includes(userId) ? state.migratedUserIds : [...state.migratedUserIds, userId],
                        }));
                        if (migration.failed.length) reportAssetSyncError(new Error(`${migration.failed.length} 项旧资产暂未迁移，已保留在当前浏览器，下次打开时会继续尝试`));
                    }
                });
                void flushAssetSyncOutbox();
            },
            loadMoreServerAssets: async () => {
                if (!PUBLIC_MODE || serverAssetMoreTask) return serverAssetMoreTask || undefined;
                const current = get();
                if (!current.serverHydrated || !current.ownerUserId || !current.serverAssetHasMore || current.serverAssetLoading) return;
                const requestVersion = assetHydrationVersion;
                const userId = current.ownerUserId;
                const page = current.serverAssetPage + 1;
                const pageSize = current.serverAssetPageSize || 60;
                set({ serverAssetLoading: true });
                const task = enqueueAssetLibraryMutation(async () => {
                    try {
                        if (!isActiveAssetOwner(userId) || requestVersion !== assetHydrationVersion) return;
                        const remote = await fetchServerAssetLibrary(userId, { page, pageSize });
                        if (requestVersion !== assetHydrationVersion || !isActiveAssetOwner(userId)) return;
                        const assets = await Promise.all(remote.items.map(hydrateServerAsset));
                        if (requestVersion !== assetHydrationVersion) return;
                        set((state) => ({
                            assets: preservePendingAssets(mergeAssetRecords(state.assets, assets), state.syncOutbox, userId),
                            serverAssetPage: remote.page || page,
                            serverAssetPageSize: remote.pageSize || pageSize,
                            serverAssetHasMore: Boolean(remote.hasMore),
                            serverAssetLoading: false,
                        }));
                    } catch (error) {
                        if (requestVersion === assetHydrationVersion) {
                            set({ serverAssetLoading: false });
                            reportAssetSyncError(error);
                        }
                    } finally {
                        if (serverAssetMoreTask === task) serverAssetMoreTask = null;
                    }
                });
                serverAssetMoreTask = task;
                return task;
            },
            loadAllServerAssets: async () => {
                if (!PUBLIC_MODE) return;
                for (;;) {
                    const current = get();
                    if (!current.serverAssetHasMore) return;
                    const task = current.loadMoreServerAssets();
                    if (!task) return;
                    await task;
                    if (get().ownerUserId !== current.ownerUserId || get().serverAssetPage === current.serverAssetPage) return;
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
                    serverAssetPage: 0,
                    serverAssetPageSize: 60,
                    serverAssetHasMore: false,
                    serverAssetLoading: false,
                    migratedUserIds: Array.isArray(value.migratedUserIds) ? value.migratedUserIds.filter((item): item is string => typeof item === "string") : [],
                    assets: Array.isArray(value.assets) ? value.assets.map(normalizeAssetRecord) : [],
                    syncOutbox: Array.isArray(value.syncOutbox) ? value.syncOutbox : [],
                } as AssetStore;
            },
            partialize: (state) => ({ ownerUserId: state.ownerUserId, migratedUserIds: state.migratedUserIds, assets: state.assets, syncOutbox: state.syncOutbox }) as StorageValue<AssetStore>["state"],
            merge: (persisted, current) => {
                const stored = persisted as Partial<AssetStore> | undefined;
                const syncOutbox = stored?.syncOutbox || [];
                const ownerUserId = preparedAssetUserId ?? stored?.ownerUserId ?? "";
                const sameOwner = !stored?.ownerUserId || stored.ownerUserId === ownerUserId;
                return {
                    ...current,
                    ...stored,
                    ownerUserId,
                    syncOutbox,
                    assets: preservePendingAssets(sameOwner ? stored?.assets || [] : [], syncOutbox, ownerUserId),
                    serverHydrated: false,
                    serverAssetPage: 0,
                    serverAssetHasMore: false,
                    serverAssetLoading: false,
                };
            },
            onRehydrateStorage: () => {
                assetHydrationVersion += 1;
                return (_state, error) => {
                    if (error) {
                        useAssetStore.setState({ hydrated: false, syncStorageError: "本机素材读取失败，请重试，暂勿清除浏览器数据" });
                        return;
                    }
                    useAssetStore.setState({ hydrated: true });
                    if (preparedAssetUserId !== undefined) useAssetStore.getState().prepareForUser(preparedAssetUserId);
                    void flushAssetSyncOutbox();
                };
            },
        },
    ),
);

function isActiveAssetOwner(userId: string) {
    const state = useAssetStore.getState();
    return PUBLIC_MODE && state.hydrated && Boolean(userId) && state.ownerUserId === userId && useUserStore.getState().user?.id === userId;
}

function assertAssetOwnerReady() {
    if (PUBLIC_MODE && !isActiveAssetOwner(useAssetStore.getState().ownerUserId)) throw new Error("账户素材尚未准备好，请稍后重试");
}

function currentSyncEntry(entry: AssetSyncEntry) {
    return useAssetStore.getState().syncOutbox.find((item) => item.userId === entry.userId && item.assetId === entry.assetId && item.revision === entry.revision);
}

async function syncAssetEntry(entry: AssetSyncEntry) {
    if (!isActiveAssetOwner(entry.userId) || !currentSyncEntry(entry)) return;
    const attempt = { ...currentSyncEntry(entry)!, status: "pending" as const, attempts: (currentSyncEntry(entry)?.attempts || 0) + 1, error: undefined };
    useAssetStore.setState((state) => ({ syncingAssetId: entry.assetId, syncOutbox: state.syncOutbox.map((item) => (item.revision === entry.revision ? attempt : item)) }));
    try {
        // Never send a mutation before its intent is durable. In particular, DELETE
        // replaces a queued PUT on disk before it can remove anything from the server.
        await assetPersistenceTask;
        if (!isActiveAssetOwner(entry.userId) || !currentSyncEntry(entry)) return;
        let saved: Asset | undefined;
        if (entry.operation === "upsert" && entry.asset) {
            const prepared = await prepareAssetForServer(entry.asset, entry.userId);
            if (!isActiveAssetOwner(entry.userId) || !currentSyncEntry(entry)) return;
            useAssetStore.setState((state) => ({ syncOutbox: state.syncOutbox.map((item) => (item.revision === entry.revision ? { ...item, asset: prepared } : item)) }));
            await assetPersistenceTask;
            if (!isActiveAssetOwner(entry.userId) || !currentSyncEntry(entry)) return;
            const upsert = await upsertServerAssetLibraryItem(prepared, entry.userId);
            if (isActiveAssetOwner(entry.userId) && currentSyncEntry(entry)) saved = await hydrateServerAsset(upsert.item);
        } else if (entry.operation === "delete") {
            await deleteServerAssetLibraryItem(entry.assetId, entry.userId);
        }
        // A response for an older edit cannot acknowledge a newer edit or delete.
        if (!currentSyncEntry(entry)) return;
        useAssetStore.setState((state) => ({
            syncOutbox: state.syncOutbox.filter((item) => item.revision !== entry.revision),
            // A confirmed write still clears its outbox after an account switch,
            // but late media URL hydration must not update an inactive account.
            assets: !isActiveAssetOwner(entry.userId) ? state.assets : entry.operation === "delete" ? state.assets.filter((asset) => asset.id !== entry.assetId) : state.assets.map((asset) => (asset.id === entry.assetId && saved ? saved : asset)),
        }));
        await assetPersistenceTask;
        if (isActiveAssetOwner(entry.userId) && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent<AssetSyncSuccessDetail>(ASSET_SYNC_SUCCESS_EVENT, { detail: { userId: entry.userId, assetId: entry.assetId, operation: entry.operation } }));
        }
    } catch (error) {
        if (currentSyncEntry(entry)) {
            useAssetStore.setState((state) => ({
                syncOutbox: state.syncOutbox.map((item) =>
                    item.revision === entry.revision ? { ...item, status: "failed", retryAt: Date.now() + assetSyncRetryDelay(attempt.attempts), error: error instanceof Error ? error.message : "云端同步失败" } : item,
                ),
            }));
        }
        throw error;
    } finally {
        if (isActiveAssetOwner(entry.userId)) useAssetStore.setState({ syncingAssetId: "" });
    }
}

function flushAssetSyncOutbox(): Promise<void> {
    // Also drain edits added while the previous pass was finishing. Explicit retries
    // must not resolve just because an older, possibly empty pass has completed.
    if (assetSyncTask) return assetSyncTask.then(() => flushAssetSyncOutbox());
    const state = useAssetStore.getState();
    const userId = state.ownerUserId;
    if (!isActiveAssetOwner(userId) || (typeof navigator !== "undefined" && !navigator.onLine)) return Promise.resolve();
    if (!state.syncOutbox.some((entry) => entry.userId === userId && entry.attempts < ASSET_SYNC_MAX_ATTEMPTS && entry.retryAt <= Date.now())) return Promise.resolve();
    const task = enqueueAssetLibraryMutation(async () => {
        if (!isActiveAssetOwner(userId)) return;
        const entries = useAssetStore.getState().syncOutbox.filter((entry) => entry.userId === userId && entry.attempts < ASSET_SYNC_MAX_ATTEMPTS && entry.retryAt <= Date.now());
        for (const entry of entries) {
            if (!isActiveAssetOwner(userId) || (typeof navigator !== "undefined" && !navigator.onLine)) break;
            try {
                await syncAssetEntry(entry);
            } catch {
                // The durable per-item error is visible in AssetSyncStatus; keep draining
                // unrelated items instead of allowing one failure to block the library.
            }
        }
    }).finally(() => {
        if (assetSyncTask === task) assetSyncTask = null;
        scheduleAssetSyncRetry();
    });
    assetSyncTask = task;
    return task;
}

function scheduleAssetSyncRetry() {
    clearTimeout(assetRetryTimer);
    const state = useAssetStore.getState();
    if (!isActiveAssetOwner(state.ownerUserId) || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const entries = state.syncOutbox.filter((entry) => entry.userId === state.ownerUserId && entry.attempts < ASSET_SYNC_MAX_ATTEMPTS);
    if (!entries.length) return;
    const next = Math.min(...entries.map((entry) => entry.retryAt));
    assetRetryTimer = setTimeout(() => void flushAssetSyncOutbox(), Math.max(0, next - Date.now()));
}

function enqueueAssetLibraryMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = assetLibraryMutation.then(operation, operation);
    assetLibraryMutation = pending.then(
        () => undefined,
        () => undefined,
    );
    return pending;
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

async function fetchAllServerAssets(userId: string, firstPage: Awaited<ReturnType<typeof fetchServerAssetLibrary>>, requestVersion: number) {
    const items = [...firstPage.items];
    let page = firstPage.page || 1;
    let hasMore = Boolean(firstPage.hasMore);
    const pageSize = firstPage.pageSize || 60;
    while (hasMore) {
        if (assetHydrationVersion !== requestVersion) return null;
        page += 1;
        const remote = await fetchServerAssetLibrary(userId, { page, pageSize });
        items.push(...remote.items);
        hasMore = Boolean(remote.hasMore);
    }
    return items;
}

function normalizeAssetRecord<T extends Asset>(asset: T): T {
    const source = normalizeAssetSource(asset.source);
    const category = typeof asset.category === "string" ? asset.category.trim().slice(0, 80) || undefined : undefined;
    return { ...asset, source, category };
}

async function prepareAssetForServer(asset: Asset, expectedUserId: string): Promise<Asset> {
    if (PUBLIC_MODE && !isActiveAssetOwner(expectedUserId)) throw new Error("账号已切换，素材保留在原账号等待同步");
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
