import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real handlers with deferred I/O, without mounting the app or uploading files.
const source = ts.createSourceFile("index.tsx", readFileSync(new URL("./index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ColorAlchemyPage") as ts.FunctionDeclaration;
function handler(name: string, context: Record<string, unknown>) {
    const declarations = page.body!.statements.filter(ts.isVariableStatement).flatMap((node) => [...node.declarationList.declarations]);
    const declaration = declarations.find((node) => node.name.getText(source) === name)!;
    const code = ts.transpileModule(`(${declaration.initializer!.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    return vm.runInNewContext(code, context) as (...args: unknown[]) => Promise<void>;
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
function fixture() {
    let active = true;
    const uploads: unknown[] = [], assets: unknown[] = [], messages: unknown[] = [];
    const rendered = deferred<{ blob: Blob; compressed: boolean }>();
    const operation = { ownerId: "owner-a", signal: new AbortController().signal, isCurrent: () => active };
    const context = {
        document: { source: { title: "A private draft", key: "source-a" }, settings: {} }, workingSettings: null, saving: false,
        userId: "owner-a", PUBLIC_MODE: true,
        operationLifetimeRef: { current: { capture: () => operation } },
        captureOperation: () => operation,
        useAssetStore: { getState: () => ({ ownerUserId: "owner-a" }) },
        setSaving: () => {}, createRenderedImage: () => rendered.promise,
        uploadImage: async (_blob: Blob, options: unknown) => { uploads.push(options); return { url: "a.png", storageKey: "a" }; },
        addAsset: (asset: unknown) => assets.push(asset),
        message: { success: (value: unknown) => messages.push(value), error: (value: unknown) => messages.push(value) },
    };
    return { context, uploads, assets, messages, rendered, invalidate: () => { active = false; } };
}

test("save stops before uploading a render completed after account/page invalidation", async () => {
    const f = fixture();
    const pending = handler("saveToAssets", f.context)();
    f.invalidate();
    f.rendered.resolve({ blob: new Blob(), compressed: false });
    await pending;
    expect(f.uploads).toHaveLength(0);
    expect(f.assets).toHaveLength(0);
    expect(f.messages).toHaveLength(0);
});

test("same-account save binds upload ownership and still archives the result", async () => {
    const f = fixture();
    const pending = handler("saveToAssets", f.context)();
    f.rendered.resolve({ blob: new Blob(), compressed: false });
    await pending;
    expect(f.uploads).toEqual([{ createThumbnail: true, expectedUserId: "owner-a", signal: f.context.captureOperation().signal }]);
    expect(f.assets).toHaveLength(1);
});

test("save ignores an upload completed after account/page invalidation", async () => {
    const f = fixture();
    const upload = deferred<{ url: string; storageKey: string }>();
    f.context.uploadImage = async () => { f.invalidate(); return upload.promise; };
    const pending = handler("saveToAssets", f.context)();
    f.rendered.resolve({ blob: new Blob(), compressed: false });
    upload.resolve({ url: "a.png", storageKey: "a" });
    await pending;
    expect(f.assets).toHaveLength(0);
    expect(f.messages).toHaveLength(0);
});

test("a mismatched asset store prevents saving even while the account still matches", async () => {
    const f = fixture();
    f.context.useAssetStore.getState = () => ({ ownerUserId: "owner-b" });
    await handler("saveToAssets", f.context)();
    expect(f.uploads).toHaveLength(0);
    expect(f.assets).toHaveLength(0);
});

for (const stage of ["render", "upload", "success"] as const) {
    test(`return to canvas: ${stage === "success" ? "preserves concurrent edits" : `ignores invalidation during ${stage}`}`, async () => {
        const f = fixture();
        const writes: unknown[] = [], navigation: unknown[] = [];
        let nodes = [{ id: "old", position: { x: 0, y: 0 }, width: 10 }];
        const context = { ...f.context,
            document: { ...f.context.document, source: { ...f.context.document.source, origin: { projectId: "p", nodeId: "old" } } },
            returning: false, setReturning: () => {},
            useCanvasStore: { getState: () => ({ ownerUserId: "owner-a", openProject: () => ({ id: "p", nodes }), updateProject: (_id: string, patch: unknown) => writes.push(patch) }) },
            fitNodeSize: () => ({ width: 10, height: 10 }), createCanvasNode: () => ({ id: "new", metadata: {} }),
            CanvasNodeType: { Image: "image" }, imageMetadata: () => ({}), navigate: (route: string) => navigation.push(route),
        };
        if (stage === "upload") context.uploadImage = async () => { f.invalidate(); return { url: "a.png", storageKey: "a" }; };
        const pending = handler("returnToCanvas", context)();
        if (stage === "render") f.invalidate();
        nodes = [...nodes, { id: "concurrent", position: { x: 20, y: 0 }, width: 10 }];
        f.rendered.resolve({ blob: new Blob(), compressed: false });
        await pending;
        if (stage === "success") {
            expect(writes).toHaveLength(1);
            expect((writes[0] as { nodes: { id: string }[] }).nodes.map((node) => node.id)).toEqual(["old", "concurrent", "new"]);
            expect(navigation).toEqual(["/canvas/p"]);
            expect(f.uploads).toEqual([{ createThumbnail: true, expectedUserId: "owner-a", signal: f.context.captureOperation().signal }]);
        } else {
            expect(writes).toHaveLength(0);
            expect(navigation).toHaveLength(0);
            expect(f.messages).toHaveLength(0);
            if (stage === "render") expect(f.uploads).toHaveLength(0);
        }
    });
}

for (const name of ["importFile", "addReference"]) {
    test(`${name} discards an upload from an expired operation`, async () => {
        const f = fixture();
        const writes: unknown[] = [], revoked: string[] = [];
        const context = { ...f.context,
            uploading: false, referenceLoading: false, setUploading: () => {}, setReferenceLoading: () => {},
            URL: { createObjectURL: () => "blob:preview", revokeObjectURL: (url: string) => revoked.push(url) },
            uploadImage: async (_file: unknown, options: unknown) => { f.uploads.push(options); f.invalidate(); return { storageKey: "a" }; },
            openSource: (value: unknown) => writes.push(value), setReference: (value: unknown) => writes.push(value),
            analyzeColorSource: () => { throw new Error("Must not analyze expired operation"); }, stripExtension: (name: string) => name,
        };
        await handler(name, context)({ type: "image/png", name: "a.png" });
        expect(f.uploads).toHaveLength(1);
        expect((f.uploads[0] as { expectedUserId: string }).expectedUserId).toBe("owner-a");
        expect(writes).toHaveLength(0);
        expect(f.messages).toHaveLength(0);
        expect(revoked).toEqual(["blob:preview"]);
    });
}

test("late deletion failure cannot restore an old draft into the next account", async () => {
    const f = fixture();
    const pendingDelete = deferred<{ deleted: { deletedAt: string } }>();
    const merges: unknown[] = [];
    const started = deferred<void>();
    const context = { ...f.context,
        documents: [{ id: "draft-a" }], deletedDocumentIdsRef: { current: new Map() }, syncedVersionsRef: { current: new Map() }, syncTasksRef: { current: new Map() },
        removeDocument: () => {}, mergeDocuments: (items: unknown) => merges.push(items),
        deleteColorAlchemyDocument: () => { started.resolve(); return pendingDelete.promise; },
    };
    const pending = handler("discardDocument", context)("draft-a");
    await started.promise;
    f.invalidate();
    pendingDelete.reject(new Error("network"));
    await pending;
    expect(merges).toHaveLength(0);
    expect(f.messages).toHaveLength(0);
});

test("late clipboard read does not apply settings to another session", async () => {
    const f = fixture();
    const clipboard = deferred<string>(), writes: unknown[] = [];
    const context = { ...f.context, navigator: { clipboard: { readText: () => clipboard.promise } },
        normalizeColorSettings: (value: unknown) => value, applyCommittedSettings: (value: unknown) => writes.push(value),
    };
    const pending = handler("pasteSettings", context)();
    f.invalidate();
    clipboard.resolve("{}");
    await pending;
    expect(writes).toHaveLength(0);
    expect(f.messages).toHaveLength(0);
});

test("late cloud save failure cannot schedule retries or update the next session", async () => {
    const f = fixture();
    const save = deferred<unknown>();
    const timers: Array<() => void> = [], ticks: unknown[] = [];
    const context = { ...f.context, userId: "owner-a", hydrated: true, cloudReadyUserId: "owner-a",
        documents: [{ id: "a", source: { storageKey: "a" }, updatedAt: "1" }],
        deletedDocumentIdsRef: { current: new Map() }, syncedVersionsRef: { current: new Map() }, syncTasksRef: { current: new Map() },
        syncRetryAfterRef: { current: new Map() }, syncRetryTimersRef: { current: new Map() },
        window: { setTimeout: (callback: () => void) => timers.push(callback), clearTimeout: () => {} },
        saveColorAlchemyDocument: () => save.promise, setSyncTick: (value: unknown) => ticks.push(value),
    };
    const effects = page.body!.statements.filter(ts.isExpressionStatement).map((node) => node.expression).filter(ts.isCallExpression);
    const callback = effects.find((node) => node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("const persistable"))!.arguments[0];
    vm.runInNewContext(ts.transpileModule(`(${callback.getText(source)})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    timers[0]();
    f.invalidate();
    save.reject(new Error("network"));
    await Promise.all(context.syncTasksRef.current.values());
    expect(timers).toHaveLength(1);
    expect(ticks).toHaveLength(0);
    expect(context.syncRetryAfterRef.current.size).toBe(0);
});
