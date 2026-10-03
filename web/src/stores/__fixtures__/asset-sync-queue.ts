// Separate process: no browser, storage, or transport mocks escape into other tests.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import type { Asset } from "../use-asset-store";
import type { AssetSyncEntry, AssetSyncSuccessDetail } from "../asset-sync-queue";
import type { ReactElement, ReactNode } from "react";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
}

const scenario = process.argv[2];
const disk = new Map<string, string>();
const storageKey = "infinite-canvas:asset_store";
const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: "" });
const draft = { kind: "text" as const, title: "本地草稿", coverUrl: "", tags: [], data: { content: "不能丢失" } };
const textAsset = (id: string): Asset => ({ ...draft, id, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
const calls: { operation: string; userId: string; id?: string; title?: string }[] = [];
const successes: AssetSyncSuccessDetail[] = [];
const remote = new Map<string, Map<string, Asset>>();
const catalog = (userId: string) => {
    if (!remote.has(userId)) remote.set(userId, new Map());
    return remote.get(userId)!;
};
let rejectWrites = false;
let rejectReads = scenario === "storage-read-failure" || scenario === "cleanup-read-failure";
let failUpsert = true;
let failDelete = false;
let loseUpsertResponse = false;
let loseDeleteResponse = false;
let upsertGate: ReturnType<typeof deferred> | undefined;
let deleteGate: ReturnType<typeof deferred> | undefined;
let readGate: ReturnType<typeof deferred> | undefined;
let uploadGate: ReturnType<typeof deferred> | undefined;
let mediaUrlGate: ReturnType<typeof deferred> | undefined;
let mediaUrlCalls = 0;
const hydrationGate = scenario === "early-account-switch" || scenario === "cleanup-unread-outbox" ? deferred() : undefined;
const scheduled = new Map<number, { callback: () => void; delay: number }>();
let clock = Date.now();
let timerId = 0;
if (scenario === "automatic-backoff") {
    Date.now = () => clock;
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
        scheduled.set(++timerId, { callback, delay });
        return timerId;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => {
        scheduled.delete(id);
    }) as unknown as typeof clearTimeout;
}
let uploadCalls = 0;
const events = new EventTarget();
events.addEventListener("canvas:asset-sync-success", (event) => successes.push((event as CustomEvent<AssetSyncSuccessDetail>).detail));
Object.defineProperty(globalThis, "window", { value: Object.assign(events, { __RUNTIME_CONFIG__: { PUBLIC_MODE: scenario !== "local-mode" }, setTimeout, clearTimeout }), configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const online = (value: boolean) => Object.defineProperty(navigator, "onLine", { value, configurable: true });
const seedAsset = textAsset("seed");
const seedEntry: AssetSyncEntry = { userId: "alice", assetId: "seed", asset: seedAsset, operation: "upsert", revision: "seed-revision", status: "failed", attempts: 3, retryAt: 0 };
const seedStoredData = Boolean(hydrationGate || rejectReads);
disk.set(storageKey, JSON.stringify({ version: 3, state: { ownerUserId: "alice", migratedUserIds: ["alice", "bob"], assets: seedStoredData ? [seedAsset] : [], syncOutbox: seedStoredData ? [seedEntry] : [] } }));
mock.module("@/lib/localforage-storage", () => ({
    localForageStorage: {
        getItem: async (key: string) => {
            await hydrationGate?.promise;
            return disk.get(key) ?? null;
        },
        removeItem: async (key: string) => disk.delete(key),
    },
}));
mock.module("localforage", () => ({
    default: {
        getItem: async (key: string) => {
            await hydrationGate?.promise;
            if (rejectReads) throw new Error("read unavailable");
            return disk.get(key) ?? null;
        },
        removeItem: async (key: string) => disk.delete(key),
        setItem: async (key: string, value: string) => {
            if (rejectWrites) throw new Error("disk full");
            disk.set(key, value);
            return value;
        },
    },
}));
mock.module("@/services/image-storage", () => ({
    resolveImageUrl: async (key: string) => "/api/assets/" + key,
    uploadImage: async (_url: string, options: { expectedUserId: string }) => {
        assert.equal(options.expectedUserId, useUserStore.getState().user?.id);
        uploadCalls += 1;
        await uploadGate?.promise;
        return { storageKey: "uploaded", url: "/api/assets/uploaded", width: 1, height: 1, bytes: 1, mimeType: "image/png" };
    },
}));
mock.module("@/services/file-storage", () => ({
    resolveMediaUrl: async (key: string) => {
        mediaUrlCalls += 1;
        await mediaUrlGate?.promise;
        return "/api/assets/" + key;
    },
    uploadMediaFile: async () => {
        throw new Error("unexpected video upload");
    },
}));
const persistedEntries = () => (JSON.parse(disk.get(storageKey)!).state.syncOutbox || []) as AssetSyncEntry[];
const recordCall = (operation: string, userId: string, id?: string, title?: string) => {
    assert.equal(userId, useUserStore.getState().user?.id, "requests must use the currently active owner");
    if (operation !== "read")
        assert.ok(
            persistedEntries().some((entry) => entry.userId === userId && entry.assetId === id && entry.operation === operation),
            "mutation intent must be on disk before transport",
        );
    calls.push({ operation, userId, id, title });
};
mock.module("@/services/server-api", () => ({
    fetchServerAssetLibrary: async (userId: string, options: { page: number }) => {
        recordCall("read", userId);
        const items = structuredClone([...catalog(userId).values()]);
        await readGate?.promise;
        return { initialized: true, items, page: options.page, pageSize: 60, hasMore: false };
    },
    upsertServerAssetLibraryItem: async (item: Asset, userId: string) => {
        recordCall("upsert", userId, item.id, item.title);
        await upsertGate?.promise;
        if (failUpsert) throw new Error("offline");
        // The real server keeps a storage key and deliberately blanks video URLs.
        const saved = item.kind === "video" ? { ...item, data: { ...item.data, url: "" } } : item;
        catalog(userId).set(item.id, structuredClone(saved));
        if (loseUpsertResponse) throw new Error("lost PUT response");
        return { item: structuredClone(saved) };
    },
    replaceServerAssetLibrary: async () => {
        throw new Error("unexpected catalog replacement");
    },
    deleteServerAssetLibraryItem: async (id: string, userId: string) => {
        recordCall("delete", userId, id);
        await deleteGate?.promise;
        if (failDelete) throw new Error("delete unavailable");
        catalog(userId).delete(id);
        if (loseDeleteResponse) throw new Error("lost DELETE response");
    },
}));

async function until(predicate: () => boolean) {
    const deadline = performance.now() + 2000;
    while (!predicate()) {
        assert.ok(performance.now() < deadline, "condition did not settle");
        await Bun.sleep(1);
    }
}

const { useUserStore } = await import("../use-user-store");
const { useAssetStore } = await import("../use-asset-store");
const { pendingAssetUpserts, assetSaveMessage } = await import("../asset-sync-queue");
const state = () => useAssetStore.getState();
const pending = (id: string, userId = "alice") => state().syncOutbox.find((entry) => entry.userId === userId && entry.assetId === id);
const mutationCalls = () => calls.filter((call) => call.operation !== "read");
const changeUser = (id: string) => {
    useUserStore.getState().setSession(user(id));
    state().prepareForUser(id);
};

if (scenario.startsWith("cleanup-")) {
    changeUser("alice");
    if (rejectReads) await until(() => Boolean(state().syncStorageError));
    else if (!hydrationGate) await until(() => state().hydrated);
    const react = await import("react");
    const confirmations: { onOk: () => Promise<void> }[] = [];
    const warnings: string[] = [];
    const cleanups: { owner: string; keys: string[] }[] = [];
    // Shallow-render the actual component and invoke its callbacks. All storage,
    // transport, and UI mocks stay in this child process; cleanup never deletes.
    const values: unknown[] = [true, { owner: "alice", data: {
        items: [{ key: "uploaded", status: "unused", bytes: 1, mimeType: "video/mp4", createdAt: "2026-01-01", references: [] }],
        byKind: [], generationOutputs: { usedBytes: 0, limitBytes: 100 },
        usedBytes: 1, limitBytes: 100, remainingBytes: 99, reclaimableBytes: 1, graceMs: 0, page: 1, pageSize: 60, total: 1,
    } }, false, "", 1, "all", 0, ["uploaded"], false];
    let hookIndex = 0;
    mock.module("react", () => ({ ...react,
        useEffect: () => undefined,
        useRef: (current: unknown) => ({ current }),
        useState: () => [values[hookIndex++], () => undefined],
    }));
    mock.module("antd", () => ({
        App: { useApp: () => ({ modal: { confirm: (options: { onOk: () => Promise<void> }) => confirmations.push(options) }, message: { warning: (reason: string) => warnings.push(reason), success: () => undefined, info: () => undefined, error: () => undefined } }) },
        Alert: "Alert", Button: "Button", Checkbox: "Checkbox", Drawer: "Drawer", Empty: "Empty", Pagination: "Pagination", Segmented: "Segmented", Spin: "Spin", Tag: "Tag",
    }));
    mock.module("lucide-react", () => ({ HardDrive: "HardDrive", RefreshCw: "RefreshCw", Trash2: "Trash2" }));
    mock.module("@/lib/image-utils", () => ({ formatBytes: (bytes: number) => String(bytes) }));
    mock.module("@/services/storage-management", () => ({
        fetchStorageOverview: async () => { throw new Error("unexpected overview request"); },
        cleanupStorageFiles: async (owner: string, keys: string[]) => {
            cleanups.push({ owner, keys });
            return { deletedCount: 1, skippedCount: 0, freedBytes: 1 };
        },
    }));
    mock.module("@/stores/use-asset-store", () => ({ useAssetStore: Object.assign((selector: (current: ReturnType<typeof state>) => unknown) => selector(state()), useAssetStore) }));
    mock.module("@/stores/use-user-store", () => ({ useUserStore: Object.assign((selector: (current: ReturnType<typeof useUserStore.getState>) => unknown) => selector(useUserStore.getState()), useUserStore) }));
    const { default: StorageManager } = await import("@/pages/assets/storage-manager");
    type ViewProps = { children?: ReactNode; footer?: ReactNode; disabled?: boolean; onClick?: () => void; title?: string };
    function elements(node: ReactNode): ReactElement<ViewProps>[] {
        if (Array.isArray(node)) return node.flatMap(elements);
        if (!react.isValidElement<ViewProps>(node)) return [];
        return [node, ...elements(node.props.children), ...elements(node.props.footer)];
    }
    const render = () => {
        hookIndex = 0;
        const view = elements(StorageManager());
        return { button: view.find(item => item.type === "Button" && item.props.children === "清理所选文件")!, alerts: view.filter(item => item.type === "Alert") };
    };
    const expectBlocked = (reason: RegExp) => {
        const { button, alerts } = render();
        assert.equal(button.props.disabled, true, "cleanup must stay disabled while durable asset state is unsafe or unknown");
        assert.ok(alerts.some(alert => reason.test(alert.props.title || "")), "show a useful nonempty reason");
        const before = confirmations.length;
        button.props.onClick!();
        assert.equal(confirmations.length, before, "blocked cleanup must not open a confirmation");
    };
    if (hydrationGate || rejectReads) {
        assert.equal(state().hydrated, false);
        assert.equal(state().syncOutbox.length, 0);
        assert.equal(persistedEntries()[0]?.assetId, "seed", "durable records are still unread");
        expectBlocked(rejectReads ? /读取失败/ : /读取/);
        rejectReads = false;
        hydrationGate?.resolve();
        if (!hydrationGate) await useAssetStore.persist.rehydrate();
        await until(() => state().hydrated && !state().syncStorageError);
        expectBlocked(/同步/);
    } else {
        const ready = { hydrated: true, ownerUserId: "alice", syncStorageError: "", syncOutbox: [] as AssetSyncEntry[] };
        const cases = [
            { patch: { hydrated: false }, reason: /读取/ },
            { patch: { syncStorageError: "本机素材读取失败，请重试" }, reason: /读取失败/ },
            { patch: { syncStorageError: "本机保存失败，请释放空间" }, reason: /保存失败/ },
            { patch: { ownerUserId: "bob" }, reason: /账号/ },
            { patch: { syncOutbox: [{ ...seedEntry, status: "pending" as const }] }, reason: /同步/ },
            { patch: { syncOutbox: [seedEntry] }, reason: /同步/ },
        ];
        for (const { patch, reason } of cases) {
            useAssetStore.setState(ready);
            if (scenario === "cleanup-modal-recheck") {
                render().button.props.onClick!();
                const modal = confirmations.at(-1)!;
                useAssetStore.setState(patch);
                await assert.rejects(modal.onOk(), reason);
                assert.match(warnings.at(-1) || "", reason);
                assert.equal(cleanups.length, 0);
            } else {
                useAssetStore.setState(patch);
                expectBlocked(reason);
            }
        }
        useAssetStore.setState(ready);
        render().button.props.onClick!();
        useUserStore.getState().setSession(user("bob"));
        await assert.rejects(confirmations.at(-1)!.onOk(), /账号/);
        assert.match(warnings.at(-1) || "", /账号/);
        assert.equal(cleanups.length, 0);
        changeUser("alice");
        // Exercise an actual rejected write with an empty in-memory outbox.
        rejectWrites = true;
        useAssetStore.setState(ready);
        await until(() => Boolean(state().syncStorageError));
        assert.equal(state().syncOutbox.length, 0);
        expectBlocked(/保存失败/);
        rejectWrites = false;
        useAssetStore.setState({ ...ready, syncOutbox: [{ ...seedEntry, userId: "bob" }] });
        const { button } = render();
        assert.equal(button.props.disabled, false, "other owners' records do not block a ready owner");
        button.props.onClick!();
        await confirmations.at(-1)!.onOk();
        assert.deepEqual(cleanups, [{ owner: "alice", keys: ["uploaded"] }]);
    }
} else if (rejectReads) {
    changeUser("alice");
    await until(() => Boolean(state().syncStorageError));
    assert.equal(state().hydrated, false);
    assert.throws(() => state().addAsset(draft));
    assert.equal(persistedEntries()[0]?.assetId, "seed", "read failure must not wipe unread data");
    rejectReads = false;
    await state().retryAssetSync();
    assert.equal(state().hydrated, true);
    assert.ok(state().assets.some((asset) => asset.id === "seed"));
} else if (hydrationGate) {
    changeUser("bob");
    hydrationGate.resolve();
    await until(() => state().hydrated);
    assert.equal(state().ownerUserId, "bob");
    assert.equal(state().assets.length, 0, "late local rehydration must not expose Alice's assets to Bob");
    assert.ok(pending("seed"));
    await state().hydrateFromServer("bob");
    await state().flushAssetSync();
    assert.equal(mutationCalls().length, 0);
} else {
    await until(() => state().hydrated);
    changeUser("alice");
    await state().hydrateFromServer("alice");
    await state().flushAssetSync();
    if (scenario.startsWith("video-sync-")) {
        failUpsert = false;
        if (scenario !== "video-sync-url") mediaUrlGate = deferred();
        const video = { ...draft, kind: "video" as const, coverUrl: "/api/assets/video-original", data: { url: "/api/assets/video-original", storageKey: "video-original", width: 16, height: 9, bytes: 10, mimeType: "video/mp4" } };
        const id = state().addAsset(video);
        if (mediaUrlGate) {
            await until(() => mediaUrlCalls === 1);
            const revision = pending(id)!.revision;
            assert.equal(successes.length, 0, "URL hydration must finish before signaling success");
            if (scenario === "video-sync-latest-edit") {
                online(false);
                state().updateAsset(id, { title: "等待地址时的新编辑", data: { ...video.data, storageKey: "video-edited", url: "/api/assets/video-edited" } });
                const latestRevision = pending(id)!.revision;
                assert.notEqual(latestRevision, revision);
                mediaUrlGate.resolve();
                await state().flushAssetSync();
                const edited = state().assets.find(asset => asset.id === id)!;
                assert.equal(edited.title, "等待地址时的新编辑");
                assert.equal(edited.kind === "video" && edited.data.url, "/api/assets/video-edited");
                assert.equal(pending(id)?.revision, latestRevision);
                assert.equal(persistedEntries()[0]?.revision, latestRevision);
                assert.equal(successes.length, 0, "stale URL resolution cannot acknowledge a newer edit");
                online(true);
            } else {
                if (scenario === "video-sync-account-switch") {
                    changeUser("bob");
                    useAssetStore.setState({ assets: [{ ...textAsset(id), title: "Bob 同 ID 素材" }] });
                } else {
                    // Session changes can precede prepareForUser; ownerUserId alone is insufficient.
                    useUserStore.getState().setSession(user("bob"));
                }
                const before = structuredClone(state().assets);
                mediaUrlGate.resolve();
                await state().flushAssetSync();
                assert.deepEqual(state().assets, before, "late URL resolution must not update an inactive account");
                assert.equal(pending(id), undefined, "acknowledge only the original successful server write");
                assert.equal(persistedEntries().some(entry => entry.userId === "alice" && entry.assetId === id), false);
                assert.equal(successes.length, 0);
                assert.equal(mutationCalls().length, 1);
                changeUser("alice");
                await state().hydrateFromServer("alice");
            }
        }
        await state().flushAssetSync();
        const saved = state().assets.find(asset => asset.id === id)!;
        const expectedUrl = scenario === "video-sync-latest-edit" ? "/api/assets/video-edited" : "/api/assets/video-original";
        assert.equal(saved.kind === "video" && saved.data.url, expectedUrl);
        assert.equal(saved.coverUrl, expectedUrl);
        const remoteVideo = catalog("alice").get(id)!;
        assert.equal(remoteVideo.kind === "video" && remoteVideo.data.url, "", "emulate the real server response");
        assert.equal(state().getAssetSyncStatus(id), "synced");
        assert.equal(pending(id), undefined);
        assert.equal(persistedEntries().some(entry => entry.assetId === id), false);
        if (scenario === "video-sync-url" || scenario === "video-sync-latest-edit") {
            assert.deepEqual(successes, [{ userId: "alice", assetId: id, operation: "upsert" }]);
        }
    } else if (scenario === "local-mode") {
        const id = state().addAsset(draft);
        assert.equal(await state().waitForAssetLocalSave(id), "local");
        state().updateAsset(id, { title: "本地模式编辑" });
        assert.equal(state().assets[0]?.title, "本地模式编辑");
        assert.equal(state().syncOutbox.length, 0);
        await state().removeAsset(id);
        assert.equal(state().assets.length, 0);
        assert.equal(calls.length, 0);
    } else if (scenario === "failed-hydration") {
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        assert.equal(state().getAssetSyncStatus(id), "failed");
        useAssetStore.setState({ serverHydrated: false });
        await state().hydrateFromServer("alice");
        assert.equal(state().assets.find((asset) => asset.id === id)?.title, draft.title);
        await state().waitForAssetLocalSave(id);
        assert.ok(persistedEntries().some((entry) => entry.assetId === id));
        assert.deepEqual(
            pendingAssetUpserts(state().syncOutbox, "alice").map((asset) => asset.id),
            [id],
        );
        assert.deepEqual(pendingAssetUpserts(state().syncOutbox, "bob"), []);
        assert.equal(successes.length, 0, "failures must not signal a cloud save");
    } else if (scenario === "offline-reload") {
        online(false);
        const id = state().addAsset(draft);
        assert.equal(await state().waitForAssetLocalSave(id), "pending");
        assert.equal(mutationCalls().length, 0);
        assert.equal(assetSaveMessage(state().getAssetSyncStatus(id)), "已保存到本机，等待云端同步");
        await useAssetStore.persist.rehydrate();
        assert.equal(pending(id)?.asset?.title, draft.title);
        failUpsert = false;
        online(true);
        await state().flushAssetSync();
        assert.ok(catalog("alice").has(id));
        assert.equal(pending(id), undefined);
        assert.deepEqual(successes, [{ userId: "alice", assetId: id, operation: "upsert" }]);
    } else if (scenario === "remote-page-edit") {
        failUpsert = false;
        upsertGate = deferred();
        const asset = textAsset("remote-only");
        catalog("alice").set(asset.id, asset);
        assert.equal(
            state().assets.some((item) => item.id === asset.id),
            false,
        );
        assert.equal(state().saveAsset({ ...asset, title: "第一次编辑" }), asset.id);
        assert.equal(await state().waitForAssetLocalSave(asset.id), "pending");
        await until(() => mutationCalls().length === 1);
        state().saveAsset({ ...asset, title: "替换旧队列的最新编辑" });
        assert.equal(state().syncOutbox.length, 1);
        upsertGate.resolve();
        await state().flushAssetSync();
        assert.equal(catalog("alice").size, 1);
        assert.equal(catalog("alice").get(asset.id)?.title, "替换旧队列的最新编辑");
        assert.equal(state().assets[0]?.createdAt, asset.createdAt);
        assert.equal(state().getAssetSyncStatus(asset.id), "synced");
        rejectWrites = true;
        state().saveAsset({ ...asset, title: "写入空间不足" });
        await assert.rejects(state().waitForAssetLocalSave(asset.id), /disk full/);
        await state().flushAssetSync();
        assert.equal(mutationCalls().length, 2);
    } else if (scenario === "latest-edit") {
        failUpsert = false;
        upsertGate = deferred();
        const id = state().addAsset(draft);
        await until(() => mutationCalls().length === 1);
        state().updateAsset(id, { title: "编辑中途的新内容" });
        upsertGate.resolve();
        await until(() => !pending(id));
        assert.equal(mutationCalls().length, 2);
        assert.equal(catalog("alice").get(id)?.title, "编辑中途的新内容");
        assert.equal(successes.length, 1, "an old response must not announce the latest edit as saved");
    } else if (scenario === "account-switch") {
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        changeUser("bob");
        assert.equal(state().assets.length, 0);
        await state().hydrateFromServer("bob");
        failUpsert = false;
        const bobId = state().addAsset({ ...draft, title: "Bob 素材" });
        await state().flushAssetSync();
        assert.deepEqual([...catalog("bob").keys()], [bobId]);
        assert.ok(pending(id));
        changeUser("alice");
        assert.equal(state().assets.find((asset) => asset.id === id)?.title, draft.title);
        await state().retryAssetSync(id);
        assert.ok(catalog("alice").has(id));
        assert.equal(catalog("alice").has(bobId), false);
    } else if (scenario === "duplicate-delete") {
        failUpsert = false;
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        deleteGate = deferred();
        let firstDone = false;
        const first = state()
            .removeAsset(id)
            .then(() => {
                firstDone = true;
            });
        const second = state().removeAsset(id);
        await until(() => mutationCalls().some((call) => call.operation === "delete"));
        assert.equal(firstDone, false, "every deletion caller must wait for server confirmation");
        deleteGate.resolve();
        await Promise.all([first, second]);
        assert.equal(mutationCalls().filter((call) => call.operation === "delete").length, 1);
        assert.equal(state().assets.length, 0);
    } else if (scenario === "delete-in-flight") {
        failUpsert = false;
        upsertGate = deferred();
        deleteGate = deferred();
        const id = state().addAsset(draft);
        await until(() => mutationCalls().length === 1);
        const removing = state().removeAsset(id);
        assert.equal(pending(id)?.operation, "delete");
        assert.throws(() => state().updateAsset(id, { title: "不能覆盖删除" }));
        state().replaceAssets(state().assets);
        upsertGate.resolve();
        await until(() => mutationCalls().some((call) => call.operation === "delete"));
        assert.ok(
            state().assets.some((asset) => asset.id === id),
            "delete must keep the item until server confirmation",
        );
        assert.equal(pendingAssetUpserts(state().syncOutbox, "alice").length, 0);
        deleteGate.resolve();
        await removing;
        await state().flushAssetSync();
        assert.equal(state().assets.length, 0);
        assert.equal(catalog("alice").size, 0);
        assert.deepEqual(
            mutationCalls().map((call) => call.operation),
            ["upsert", "delete"],
        );
        await useAssetStore.persist.rehydrate();
        await state().flushAssetSync();
        assert.equal(catalog("alice").size, 0);
        assert.deepEqual(successes, [{ userId: "alice", assetId: id, operation: "delete" }]);
    } else if (scenario === "delete-failure-reload") {
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        failDelete = true;
        await assert.rejects(state().removeAsset(id), /delete unavailable/);
        assert.ok(state().assets.some((asset) => asset.id === id));
        await state().waitForAssetLocalSave(id);
        await useAssetStore.persist.rehydrate();
        assert.equal(pending(id)?.operation, "delete");
        assert.equal(pending(id)?.status, "failed");
        failDelete = false;
        loseDeleteResponse = true;
        await state().retryAssetSync(id);
        assert.equal(pending(id)?.operation, "delete");
        loseDeleteResponse = false;
        await useAssetStore.persist.rehydrate();
        await state().retryAssetSync(id);
        assert.equal(pending(id), undefined);
        assert.equal(state().assets.length, 0);
        assert.equal(mutationCalls().filter((call) => call.operation === "upsert").length, 1);
    } else if (scenario === "delete-account-switch") {
        failUpsert = false;
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        deleteGate = deferred();
        const removing = state()
            .removeAsset(id)
            .catch((error) => error);
        await until(() => mutationCalls().some((call) => call.operation === "delete"));
        changeUser("bob");
        catalog("bob").set(id, { ...textAsset(id), title: "Bob 同 ID 素材" });
        const hydration = state().hydrateFromServer("bob");
        deleteGate.resolve();
        assert.ok((await removing) instanceof Error);
        await hydration;
        assert.equal(state().assets[0]?.title, "Bob 同 ID 素材");
        assert.ok(catalog("bob").has(id));
    } else if (scenario === "delete-uncached") {
        catalog("alice").set("uncached", textAsset("uncached"));
        await state().removeAsset("uncached");
        assert.equal(catalog("alice").size, 0);
        assert.equal(state().syncOutbox.length, 0);
    } else if (scenario === "stale-hydration") {
        readGate = deferred();
        useAssetStore.setState({ serverHydrated: false });
        const before = calls.length;
        const hydration = state().hydrateFromServer("alice");
        await until(() => calls.length > before);
        const id = state().addAsset(draft);
        state().updateAsset(id, { title: "回填期间的新内容" });
        readGate.resolve();
        await hydration;
        await state().flushAssetSync();
        assert.equal(state().assets.find((asset) => asset.id === id)?.title, "回填期间的新内容");
        assert.equal(mutationCalls().length, 1, "edits queued before sending must coalesce");
    } else if (scenario === "pending-pagination") {
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        catalog("alice").set(id, { ...textAsset(id), title: "来自未来时钟的旧数据", updatedAt: "2099-01-01T00:00:00Z" });
        useAssetStore.setState({ serverAssetHasMore: true });
        await state().loadMoreServerAssets();
        assert.equal(state().assets.find((asset) => asset.id === id)?.title, draft.title);
    } else if (scenario === "automatic-backoff") {
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        for (const delay of [1000, 5000]) {
            assert.equal(scheduled.size, 1);
            const [key, timer] = [...scheduled][0];
            assert.equal(timer.delay, delay);
            scheduled.delete(key);
            clock += delay;
            timer.callback();
            await state().flushAssetSync();
        }
        assert.equal(scheduled.size, 0);
        assert.equal(mutationCalls().length, 3);
        assert.equal(pending(id)?.status, "failed");
    } else if (scenario === "bounded-retry") {
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        for (let i = 0; i < 6; i += 1) {
            useAssetStore.setState((current) => ({ syncOutbox: current.syncOutbox.map((entry) => ({ ...entry, retryAt: 0 })) }));
            await state().flushAssetSync();
        }
        assert.equal(mutationCalls().length, 3);
        assert.equal(pending(id)?.status, "failed");
        await state().waitForAssetLocalSave(id);
        await useAssetStore.persist.rehydrate();
        await state().flushAssetSync();
        assert.equal(mutationCalls().length, 3, "rehydration must not reset the automatic retry budget");
        failUpsert = false;
        await state().retryAssetSync(id);
        assert.equal(mutationCalls().length, 4);
        assert.equal(pending(id), undefined);
    } else if (scenario === "lost-response") {
        failUpsert = false;
        loseUpsertResponse = true;
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        assert.ok(pending(id));
        assert.equal(catalog("alice").size, 1);
        loseUpsertResponse = false;
        await state().retryAssetSync(id);
        assert.equal(catalog("alice").size, 1, "retries must reuse the same asset ID");
        assert.equal(state().getAssetSyncStatus(id), "synced");
    } else if (scenario === "delete-storage-failure") {
        online(false);
        const id = state().addAsset(draft);
        await state().waitForAssetLocalSave(id);
        rejectWrites = true;
        await assert.rejects(state().removeAsset(id), /disk full/);
        assert.equal(mutationCalls().length, 0);
        assert.ok(state().assets.some((asset) => asset.id === id));
        rejectWrites = false;
        online(true);
        await state().retryAssetSync(id);
        assert.deepEqual(
            mutationCalls().map((call) => call.operation),
            ["delete"],
        );
        assert.equal(state().assets.length, 0);
    } else if (scenario === "storage-failure") {
        rejectWrites = true;
        const id = state().addAsset(draft);
        await assert.rejects(state().waitForAssetLocalSave(id), /disk full/);
        await state().flushAssetSync();
        assert.equal(mutationCalls().length, 0, "do not send a mutation that could not be persisted");
        assert.ok(state().syncStorageError);
        rejectWrites = false;
        failUpsert = false;
        await state().retryAssetSync(id);
        assert.equal(state().syncStorageError, "");
        assert.ok(catalog("alice").has(id));
    } else if (scenario === "status-ui") {
        const id = state().addAsset(draft);
        await state().flushAssetSync();
        const { createElement } = await import("react");
        const { renderToStaticMarkup } = await import("react-dom/server");
        // Supply client snapshots to the view: Zustand's SSR snapshot intentionally
        // contains the initial logged-out state. The other scenarios test the real store.
        mock.module("@/stores/use-asset-store", () => ({ useAssetStore: Object.assign((selector: (current: ReturnType<typeof state>) => unknown) => selector(state()), useAssetStore) }));
        mock.module("@/stores/use-user-store", () => ({ useUserStore: Object.assign((selector: (current: ReturnType<typeof useUserStore.getState>) => unknown) => selector(useUserStore.getState()), useUserStore) }));
        const { AssetSyncStatus } = await import("@/components/assets/asset-sync-status");
        const html = renderToStaticMarkup(createElement(AssetSyncStatus, { assetId: id }));
        assert.ok(html.includes("云端同步失败，本机已保留"));
        assert.ok(html.includes("重试此素材同步"));
        assert.ok(html.includes('role="status"'));
        useAssetStore.setState((current) => ({ syncOutbox: [...current.syncOutbox, { ...seedEntry, userId: "bob" }] }));
        const globalHtml = renderToStaticMarkup(createElement(AssetSyncStatus));
        assert.ok(globalHtml.includes("1 项同步失败"));
        assert.equal(globalHtml.includes("2 项同步失败"), false);
    } else if (scenario === "prepared-media" || scenario === "account-switch-during-upload") {
        if (scenario === "account-switch-during-upload") uploadGate = deferred();
        const id = state().addAsset({ ...draft, kind: "image", data: { dataUrl: "data:image/png;base64,AA==", width: 1, height: 1, bytes: 1, mimeType: "image/png" } });
        if (uploadGate) {
            await until(() => uploadCalls === 1);
            changeUser("bob");
            uploadGate.resolve();
            await state().flushAssetSync();
            assert.equal(mutationCalls().length, 0, "no old-account upsert may follow a late upload response");
            assert.ok(pending(id));
        } else {
            await state().flushAssetSync();
            assert.equal(pending(id)?.asset?.kind, "image");
            const asset = pending(id)?.asset;
            assert.equal(asset?.kind === "image" && asset.data.storageKey, "uploaded");
            failUpsert = false;
            await state().retryAssetSync(id);
            assert.equal(uploadCalls, 1, "retry metadata without uploading the same media again");
            assert.ok(catalog("alice").has(id));
        }
    } else throw new Error("unknown scenario " + scenario);
}
useUserStore.getState().clearSession();
state().prepareForUser("");
await state().flushAssetSync();
console.log("PASS: " + scenario);
