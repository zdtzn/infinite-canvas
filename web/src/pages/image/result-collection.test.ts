import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import ts from "typescript";
import type { GeneratedImage } from "@/services/image-generation-runtime";
import type { ImageAsset } from "@/stores/use-asset-store";

// Exercise the page's real handlers, with local dependencies instead of global module mocks.
const source = ts.createSourceFile("index.tsx", readFileSync(new URL("./index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["resultSaved", "saveResultToAssets"]);
const snippets: string[] = [];
function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) snippets.push(`const ${node.getText(source)};`);
    ts.forEachChild(node, collect);
}
collect(source);
assert.equal(snippets.length, names.size);
const makeHandlers = new Function("deps", ts.transpileModule(`
    const { assets, failedAssetImageIds, savingAssetIdsRef, beginResultTransfer, previewLog, generationJob,
        generationUserPrompt, setSavingAssetIds, setFailedAssetImageIds, PUBLIC_MODE, useAssetStore,
        ensureStoredResult, saveAsset, IMAGE_WORKBENCH_ASSET_SOURCE, assetSaveMessage,
        message, userFacingErrorMessage, console } = deps;
    ${snippets.join("\n")}
    return { resultSaved, saveResultToAssets };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText) as (deps: Record<string, unknown>) => {
    resultSaved: (image: GeneratedImage) => boolean;
    saveResultToAssets: (image: GeneratedImage, index: number) => Promise<void>;
};

const image: GeneratedImage = { id: "result-one", dataUrl: "/api/job-files/job/result.png", storageKey: "image:one", width: 1, height: 1, bytes: 1, durationMs: 1, mimeType: "image/png", persisted: true };

function collection({ remoteAsset, failFirstLocalSave = false, status = "synced" }: { remoteAsset?: ImageAsset; failFirstLocalSave?: boolean; status?: "synced" | "failed" } = {}) {
    const records = new Map<string, ImageAsset>();
    const writes: ImageAsset[] = [];
    const localSaves: string[] = [];
    const events: string[] = [];
    const notices: Array<{ type: string }> = [];
    const errors: string[] = [];
    let failedAssetImageIds: string[] = [];
    let savingAssetIds: string[] = [];
    const savingAssetIdsRef = { current: new Set<string>() };
    const store = {
        get assets() { return [...records.values()]; },
        serverHydrated: !remoteAsset,
        serverAssetHasMore: Boolean(remoteAsset),
        hydrateFromServer: async (owner: string) => { events.push(`hydrate:${owner}`); store.serverHydrated = true; },
        loadAllServerAssets: async () => {
            events.push("load-all");
            if (remoteAsset) records.set(remoteAsset.id, remoteAsset);
            store.serverAssetHasMore = false;
        },
        waitForAssetLocalSave: async (id: string) => {
            localSaves.push(id);
            if (failFirstLocalSave && localSaves.length === 1) throw new Error("本机保存失败");
            return status;
        },
    };
    const saveAsset = (asset: ImageAsset) => { writes.push(asset); records.set(asset.id, asset); return asset.id; };
    // Recreate the closures from the latest state, as React does on each render.
    const render = () => makeHandlers({
        assets: store.assets, failedAssetImageIds, savingAssetIdsRef,
        beginResultTransfer: () => ({ ownerUserId: "owner", isCurrent: () => true }),
        previewLog: null, generationJob: { snapshot: { text: "测试画卷" } }, generationUserPrompt: (text: string) => text,
        setSavingAssetIds: (update: (ids: string[]) => string[]) => { savingAssetIds = update(savingAssetIds); },
        setFailedAssetImageIds: (update: (ids: string[]) => string[]) => { failedAssetImageIds = update(failedAssetImageIds); },
        PUBLIC_MODE: true, useAssetStore: { getState: () => store }, saveAsset,
        ensureStoredResult: async (result: GeneratedImage) => { events.push("store-image"); return result; },
        IMAGE_WORKBENCH_ASSET_SOURCE: "image-workbench", assetSaveMessage: (value: string) => value,
        message: { open: (notice: { type: string }) => notices.push(notice), error: (error: string) => errors.push(error) },
        userFacingErrorMessage: (error: Error) => error.message, console: { error: () => undefined },
    });
    return { store, writes, localSaves, events, notices, errors, render, get failedAssetImageIds() { return failedAssetImageIds; }, get savingAssetIds() { return savingAssetIds; } };
}

for (const status of ["synced", "failed"] as const) {
    test(`saving a result twice creates one collection entry when cloud sync is ${status}`, async () => {
        const fixture = collection({ status });
        await fixture.render().saveResultToAssets(image, 0);
        assert.equal(fixture.render().resultSaved(image), true);
        await fixture.render().saveResultToAssets(image, 0);
        assert.equal(fixture.writes.length, 1);
        assert.equal(fixture.store.assets.length, 1);
        assert.deepEqual(fixture.localSaves, ["image-result-result-one"]);
        assert.deepEqual(fixture.savingAssetIds, []);
        assert.equal(fixture.notices[0].type, status === "failed" ? "warning" : "success");
    });
}

test("loading remaining collection pages finds an existing result without overwriting its title or tags", async () => {
    const existing: ImageAsset = {
        id: "image-result-result-one", kind: "image", title: "用户整理的标题", tags: ["珍藏", "保留"],
        coverUrl: image.dataUrl, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
        data: { dataUrl: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 1, mimeType: "image/png" },
    };
    const fixture = collection({ remoteAsset: existing });
    assert.equal(fixture.render().resultSaved(image), false);
    await fixture.render().saveResultToAssets(image, 0);
    assert.deepEqual(fixture.events, ["hydrate:owner", "load-all"]);
    assert.equal(fixture.render().resultSaved(image), true);
    assert.equal(fixture.writes.length, 0);
    assert.strictEqual(fixture.store.assets[0], existing);
    assert.equal(fixture.store.assets[0].title, "用户整理的标题");
    assert.deepEqual(fixture.store.assets[0].tags, ["珍藏", "保留"]);
});

test("a failed local save remains retryable and retries the same collection record", async () => {
    const fixture = collection({ failFirstLocalSave: true });
    await fixture.render().saveResultToAssets(image, 0);
    assert.equal(fixture.store.assets.length, 1, "the failed write has already inserted an in-memory record");
    assert.equal(fixture.render().resultSaved(image), false);
    assert.deepEqual(fixture.failedAssetImageIds, [image.id]);
    assert.deepEqual(fixture.errors, ["本机保存失败"]);
    const original = fixture.store.assets[0];
    await fixture.render().saveResultToAssets(image, 0);
    assert.deepEqual(fixture.localSaves, [original.id, original.id]);
    assert.deepEqual(fixture.writes.map((asset) => asset.id), ["image-result-result-one", "image-result-result-one"]);
    assert.strictEqual(fixture.writes[1], original);
    assert.equal(fixture.store.assets.length, 1);
    assert.equal(fixture.events.filter((event) => event === "store-image").length, 1);
    assert.deepEqual(fixture.failedAssetImageIds, []);
    assert.deepEqual(fixture.savingAssetIds, []);
    assert.equal(fixture.render().resultSaved(image), true);
});
