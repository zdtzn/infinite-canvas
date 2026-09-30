import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import ts from "typescript";
import { useUserStore } from "@/stores/use-user-store";
import { mergePersistedImagesIntoHistoryRecord } from "@/services/image-generation-history";

// Exercise the page's actual closures without mounting its unrelated canvas/editor dependencies.
const source = ts.createSourceFile("index.tsx", readFileSync(new URL("./index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["beginResultTransfer", "ensureStoredResult", "buildResultTransfer", "sendResultToCanvas", "sendResultToColorAlchemy", "retryResultArchive"]);
const snippets: string[] = [];
function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) snippets.push(`const ${node.getText(source)};`);
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect" && node.getText(source).includes("resultTransferLifetimeRef")) snippets.push(node.getText(source));
    ts.forEachChild(node, collect);
}
collect(source);
const makeHandlers = new Function("deps", ts.transpileModule(`
    const { useEffect, resultTransferLifetimeRef, useUserStore, PUBLIC_MODE, historyUserId, uploadImage,
        replaceImageGenerationResult, setPreviewLog, navigate, preloadRoute, creativeImageTransferState,
        previewLog, generationJob, effectiveConfig, prompt, generationUserPrompt,
        retryImageGenerationArchive, mergePersistedImagesIntoHistoryRecord, logs, setLogs, saveLog } = deps;
    ${snippets.join("\n")}
    return { sendResultToCanvas, sendResultToColorAlchemy, retryResultArchive };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText);

const setOwner = (id: string) => useUserStore.getState().setSession({ id, username: id, displayName: id, avatarUrl: "" });
const image = { id: "result", dataUrl: "/api/job-files/job/result.png", width: 1, height: 1, bytes: 1, durationMs: 1, persisted: true };

for (const destination of ["Canvas", "ColorAlchemy"]) {
    for (const scenario of ["same-owner", "switch", "round-trip", "unmount", "late-error", "cached-round-trip"]) {
        test(`image transfer to ${destination}: ${scenario}`, async () => {
            const previousUser = useUserStore.getState().user;
            setOwner("a");
            let cleanup: () => void = () => undefined;
            let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
            const storage = new Promise((done, fail) => { resolve = done; reject = fail; });
            const uploads: Array<{ expectedUserId?: string }> = [];
            const effects: string[] = [];
            const transfers: Array<{ ownerUserId?: string }> = [];
            const handlers = makeHandlers({
                useEffect: (effect: () => () => void) => { cleanup = effect(); },
                resultTransferLifetimeRef: { current: { mounted: false, version: 0 } },
                useUserStore, PUBLIC_MODE: true, historyUserId: "a",
                uploadImage: (_url: string, options: { expectedUserId?: string }) => { uploads.push(options); return storage; },
                replaceImageGenerationResult: () => effects.push("replace"), setPreviewLog: () => effects.push("preview"),
                navigate: (_url: string, options: { state: { creativeImageTransfer: { ownerUserId?: string } } }) => { effects.push("navigate"); transfers.push(options.state.creativeImageTransfer); },
                preloadRoute: () => effects.push("preload"), creativeImageTransferState: (transfer: unknown) => ({ creativeImageTransfer: transfer }),
                previewLog: null, generationJob: null, effectiveConfig: {}, prompt: "test", generationUserPrompt: (text: string) => text,
            });
            try {
                const pending = handlers[`sendResultTo${destination}`](scenario === "cached-round-trip" ? { ...image, storageKey: "saved" } : image, 0);
                if (["switch", "round-trip", "late-error", "cached-round-trip"].includes(scenario)) setOwner("b");
                if (["round-trip", "cached-round-trip"].includes(scenario)) setOwner("a");
                if (scenario === "unmount") cleanup();
                if (scenario === "late-error") reject(new Error("old upload failed"));
                else resolve({ url: "/api/assets/image", storageKey: "saved", width: 1, height: 1, bytes: 1, mimeType: "image/png" });
                await pending;
                if (scenario === "same-owner") {
                    assert.equal(uploads[0].expectedUserId, "a");
                    assert.equal(transfers[0].ownerUserId, "a");
                    assert.deepEqual(effects, ["replace", "preview", "preload", "navigate"]);
                } else {
                    assert.deepEqual(effects, [], "stale operations must not write state, preload or navigate");
                }
            } finally {
                cleanup();
                useUserStore.setState({ user: previousUser });
            }
        });
    }
}

for (const scenario of ["same-owner", "switch", "round-trip", "unmount", "cached-round-trip", "cached-unmount", "stale-start"]) {
    test(`archive result continuation: ${scenario}`, async () => {
        const previousUser = useUserStore.getState().user;
        setOwner("a");
        let cleanup: () => void = () => undefined;
        let resolve!: (value: typeof image) => void;
        const pendingResult = new Promise<typeof image>((done) => { resolve = done; });
        const effects: string[] = [];
        const owners: string[] = [];
        const temporary = { ...image, persisted: false };
        const record = { id: "log", createdAt: 1, prompt: "p", model: "m", images: [temporary] };
        const handlers = makeHandlers({
            useEffect: (effect: () => () => void) => { cleanup = effect(); },
            resultTransferLifetimeRef: { current: { mounted: false, version: 0 } },
            useUserStore, PUBLIC_MODE: true, historyUserId: "a", logs: [record], previewLog: record,
            retryImageGenerationArchive: (_image: unknown, owner: string) => { owners.push(owner); return scenario.startsWith("cached-") ? Promise.resolve(image) : pendingResult; },
            mergePersistedImagesIntoHistoryRecord,
            setPreviewLog: () => effects.push("preview"), saveLog: () => effects.push("save"), setLogs: () => effects.push("logs"),
        });
        try {
            if (scenario === "stale-start") setOwner("b");
            const pending = handlers.retryResultArchive(scenario.startsWith("cached-") ? image : temporary);
            if (["switch", "round-trip", "cached-round-trip"].includes(scenario)) setOwner("b");
            if (["round-trip", "cached-round-trip"].includes(scenario)) setOwner("a");
            if (["unmount", "cached-unmount"].includes(scenario)) cleanup();
            resolve(image);
            await pending;
            assert.deepEqual(owners, scenario === "stale-start" ? [] : ["a"]);
            assert.deepEqual(effects, scenario === "same-owner" ? ["preview", "save", "logs"] : [], "obsolete page continuations must not save history or write React state");
        } finally {
            cleanup();
            useUserStore.setState({ user: previousUser });
        }
    });
}
