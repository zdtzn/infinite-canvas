import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { assetSaveMessage, type AssetSyncStatus } from "@/stores/asset-sync-queue";

// Exercise actual collection callbacks with deferred storage/upload I/O; no app mount,
// network calls, real uploads, or changes to the concurrently developed asset store.
const root = new URL("../../", import.meta.url);
const callbacks = new Map<string, string>();
function handler(path: string, name: string, context: Record<string, unknown>) {
    const key = `${path}:${name}`;
    if (!callbacks.has(key)) {
        const source = ts.createSourceFile(path, readFileSync(new URL(path, root), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        let callback: ts.Node | undefined;
        const visit = (node: ts.Node) => {
            if (ts.isFunctionDeclaration(node) && node.name?.text === name) callback = node;
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
                callback = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        if (!callback) throw new Error(`Missing callback ${key}`);
        callbacks.set(key, ts.transpileModule(`(${callback.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    }
    return vm.runInNewContext(callbacks.get(key)!, context) as (...args: unknown[]) => Promise<unknown>;
}
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const media = { url: "fixture.png", dataUrl: "fixture.png", storageKey: "fixture", width: 20, height: 20, bytes: 12, mimeType: "image/png" };
const prompt = { id: "prompt", title: "提示词", prompt: "原始内容", coverUrl: "", tags: [], category: "测试" };
const node = { id: "node", width: 20, height: 20, metadata: { content: "原始内容", prompt: "原始提示词", storageKey: "fixture" } };
const cases = [
    { label: "image", path: "pages/image/index.tsx", name: "saveResultToAssets", args: [{ id: "result" }, 0] },
    { label: "color", path: "pages/color-alchemy/index.tsx", name: "saveToAssets", args: [] },
    ...["text", "video", "image"].map((type) => ({ label: `canvas-${type}`, path: "pages/canvas/project.tsx", name: "saveNodeAsset", args: [{ ...node, type }] })),
    { label: "prompts", path: "pages/prompts/index.tsx", name: "savePromptAsset", args: [prompt] },
    { label: "source-modal", path: "components/layout/prompt-source-content-modal.tsx", name: "saveAsset", args: [prompt] },
    ...["image", "video"].map((kind) => ({ label: `side-${kind}`, path: "components/canvas/canvas-side-panel.tsx", name: "handleFiles", args: [[{ type: `${kind}/fixture`, name: "fixture" }]] })),
    ...["text", "image"].map((kind) => ({ label: `agent-${kind}`, path: "lib/agent/agent-site-tools.ts", name: "addAsset", args: [{ kind, title: "素材", content: "原始内容", imageUrl: "fixture.png" }] })),
];

function fixture() {
    const local = deferred<AssetSyncStatus>();
    const assets: unknown[] = [], waits: string[] = [], notices: Array<{ type: string; content: string }> = [];
    const uploadOwners: string[] = [];
    let account = { user: { id: "a" } }, invalidated = false;
    const subscribers = new Set<(state: typeof account, previous: typeof account) => void>();
    const store = {
        ownerUserId: "a",
        addAsset(asset: unknown) { assets.push(asset); return `asset-${assets.length}`; },
        waitForAssetLocalSave(id: string) { waits.push(id); return local.promise; },
    };
    const operation = { ownerId: "a", signal: new AbortController().signal, isCurrent: () => !invalidated };
    const context = {
        Error, console: { error: () => {} }, assetSaveMessage,
        addAsset: store.addAsset, useAssetStore: { getState: () => store },
        useUserStore: { getState: () => account, subscribe: (fn: (state: typeof account, previous: typeof account) => void) => { subscribers.add(fn); return () => subscribers.delete(fn); } },
        message: {
            open: (value: { type: string; content: string }) => notices.push(value),
            success: (content: string) => notices.push({ type: "success", content }),
            warning: (content: string) => notices.push({ type: "warning", content }),
            error: (content: string) => notices.push({ type: "error", content }),
            loading: () => () => {},
        },
        uploadImage: async (_value: unknown, options?: { expectedUserId?: string }) => { uploadOwners.push(options?.expectedUserId || ""); return media; },
        uploadMediaFile: async (_value: unknown, _kind: string, owner: string) => { uploadOwners.push(owner); return media; },
        setUploading: () => {}, fileInputRef: { current: null },
        savingAssetIdsRef: { current: new Set() }, setSavingAssetIds: () => {},
        beginResultTransfer: () => operation, ensureStoredResult: async () => media,
        previewLog: null, generationJob: { snapshot: { text: "原始提示词" } }, IMAGE_WORKBENCH_ASSET_SOURCE: "丹青台",
        document: { source: { title: "原图", key: "source" }, settings: {} }, saving: false, PUBLIC_MODE: true,
        captureOperation: () => operation, setSaving: () => {}, workingSettings: null,
        createRenderedImage: async () => ({ blob: new Blob(), compressed: false }),
        CanvasNodeType: { Text: "text", Video: "video", Image: "image" }, getDataUrlByteSize: () => 12,
    };
    return { context, store, local, assets, waits, notices, uploadOwners, subscribers,
        switchAccount(id: string) {
            const previous = account;
            account = { user: { id } };
            store.ownerUserId = id;
            invalidated = true;
            for (const subscriber of subscribers) subscriber(account, previous);
        },
    };
}

for (const entry of cases) {
    for (const outcome of ["pending", "storage-failure", "account-switch"] as const) {
        test(`${entry.label}: collection waits for local persistence (${outcome})`, async () => {
            const f = fixture();
            let settled = false;
            const pending = handler(entry.path, entry.name, f.context)(...entry.args).then(
                (value) => { settled = true; return { value, error: undefined }; },
                (error) => { settled = true; return { value: undefined, error }; },
            );
            await tick();
            expect(f.assets).toHaveLength(1);
            expect(f.waits).toEqual(["asset-1"]);
            expect(settled).toBe(false);
            expect(f.notices).toHaveLength(0);
            if (outcome === "pending") f.local.resolve("pending");
            else {
                if (outcome === "account-switch") f.switchAccount("b");
                f.local.reject(new Error(outcome === "storage-failure" ? "本机保存失败" : "素材所属账号已变更或素材已删除"));
            }
            const result = await pending;
            if (outcome === "pending") {
                expect(result.error).toBeUndefined();
                if (entry.label.startsWith("agent-")) expect(result.value).toMatchObject({ ok: true, syncStatus: "pending", message: assetSaveMessage("pending") });
                else {
                    expect(f.notices).toHaveLength(1);
                    expect(f.notices[0].type).toBe("info");
                    expect(f.notices[0].content).toContain(assetSaveMessage("pending"));
                }
            } else {
                expect(f.notices.filter((notice) => notice.type !== "error")).toHaveLength(0);
                if (entry.label.startsWith("agent-")) expect(result.error).toBeInstanceOf(Error);
                else if (outcome === "storage-failure") expect(f.notices).toHaveLength(1);
            }
            expect(f.subscribers.size).toBe(0);
        });
    }
}

for (const entry of cases.filter((item) => ["side-image", "side-video", "agent-image"].includes(item.label))) {
    test(`${entry.label}: account round trip during upload cannot write into a later session`, async () => {
        const f = fixture(), upload = deferred<typeof media>();
        f.context.uploadImage = async (_, options) => { f.uploadOwners.push(options?.expectedUserId || ""); return upload.promise; };
        f.context.uploadMediaFile = async (_, _kind, owner) => { f.uploadOwners.push(owner); return upload.promise; };
        const pending = handler(entry.path, entry.name, f.context)(...entry.args).catch((error) => error);
        await tick();
        expect(f.assets).toHaveLength(0);
        expect(f.uploadOwners).toEqual(["a"]);
        f.switchAccount("b"); f.switchAccount("a");
        upload.resolve(media);
        f.local.resolve("synced");
        await pending;
        expect(f.assets).toHaveLength(0);
        expect(f.waits).toHaveLength(0);
        expect(f.notices.filter((notice) => notice.type !== "error")).toHaveLength(0);
        expect(f.subscribers.size).toBe(0);
    });
}

for (const status of ["local", "synced", "failed"] as const) {
    test(`prompt collection displays the actual ${status} status`, async () => {
        const f = fixture();
        f.local.resolve(status);
        await handler("pages/prompts/index.tsx", "savePromptAsset", f.context)(prompt);
        expect(f.notices).toEqual([{ type: status === "failed" ? "warning" : "success", content: assetSaveMessage(status) }]);
    });
}

test("a mixed upload batch reports a failed cloud sync without losing its local-save distinction", async () => {
    const f = fixture();
    f.store.waitForAssetLocalSave = async (id) => { f.waits.push(id); return id === "asset-1" ? "synced" : "failed"; };
    await handler("components/canvas/canvas-side-panel.tsx", "handleFiles", f.context)([{ type: "image/png", name: "image" }, { type: "video/mp4", name: "video" }]);
    expect(f.waits).toEqual(["asset-1", "asset-2"]);
    expect(f.notices).toEqual([{ type: "warning", content: `${assetSaveMessage("failed")}，共 2 项` }]);
});
