import assert from "node:assert/strict";
import { test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";

// Read only production sources. No imports of application initialization, credentials,
// browser profiles, or networking. Execute the exact extracted callback bodies.
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const project = ts.createSourceFile("project.tsx", read("pages/canvas/project.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = project.statements.find((s: any) => ts.isFunctionDeclaration(s) && s.name?.text === "InfiniteCanvasPage") as any;
function effect(marker: string) {
    const found = page.body.statements.filter((s: any) => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && s.expression.expression.getText(project) === "useEffect" && s.expression.arguments[0].getText(project).includes(marker));
    assert.equal(found.length, 1, marker);
    return found[0].expression.arguments[0].getText(project);
}
function declaration(path: string, name: string) {
    const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const fn = file.statements.find((s: any) => ts.isFunctionDeclaration(s) && s.name?.text === name);
    assert.ok(fn, name);
    return fn.getText(file).replace(/^export\s+/, "");
}
function harness() {
    let now = 0,
        timerId = 0;
    const timers = new Map<number, { due: number; run: () => void }>();
    const writes: any[] = [];
    const c: any = {
        console,
        Promise,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Date,
        Error,
        DOMException,
        AbortController,
        structuredClone,
        shallow,
        setTimeout: (run: () => void, delay = 0) => {
            const id = ++timerId;
            timers.set(id, { due: now + delay, run });
            return id;
        },
        clearTimeout: (id: number) => timers.delete(id),
        fetch: () => {
            throw Error("External requests prohibited in this fixture");
        },
        create: createStore,
        persist,
        nanoid: () => "fixture-id",
        localForageStorage: {
            getItem: async () => null,
            setItem: async (name: string, value: string) => {
                writes.push(JSON.parse(value));
            },
            removeItem: async () => {},
        },
        CanvasNodeType: { Image: "image", Text: "text", Video: "video", Audio: "audio", Group: "group" },
        getDocumentNodes: (nodes: any[]) => nodes,
        generationEpochRef: { current: 0 },
        generationOwnersRef: { current: new WeakMap() },
        stoppedGenerationControllersRef: { current: new WeakSet() },
        toolSessionRef: { current: { active: true, projectId: "fixture-project", userId: "fixture-owner" } },
        PUBLIC_MODE: true,
        projectId: "fixture-project",
        projectLoaded: true,
        effectiveConfigRef: { current: { model: "fixture-model" } },
        resolveModelRequestConfig: () => ({ channelId: "fixture-channel", serverManaged: true }),
        NODE_STATUS_LOADING: "loading",
        NODE_STATUS_SUCCESS: "success",
        NODE_STATUS_ERROR: "error",
        NODE_STATUS_IDLE: "idle",
        useUserStore: { getState: () => ({ user: { id: "fixture-owner" } }) },
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        nodesRef: { current: [] },
        connectionsRef: { current: [] },
        viewportRef: { current: { x: 0, y: 0, k: 1 } },
        historyRef: { current: { past: [], future: [] } },
        lastHistoryRef: { current: null },
        historyCommitTimerRef: { current: null },
        applyingHistoryRef: { current: false },
        historyPausedRef: { current: false },
        pendingImageUploadsRef: { current: new Map() },
        generationRequestsRef: { current: new Map() },
        restoreAbortRef: { current: null },
        snapshotRestoreAbortRef: { current: null },
        hydrateCanvasImages: async (nodes: any[]) => nodes,
        hydrateAssistantImages: async (sessions: any[]) => sessions,
        message: {
            success: () => {},
            error: (value: any) => {
                c.errors.push(value);
            },
        },
        errors: [],
        friendlyErrorMessage: (e: any) => e.message,
        setDialogNodeId: () => {},
        modal: {
            confirm: (options: any) => {
                c.confirm = options;
            },
        },
        URL: { revokeObjectURL: () => {} },
    };
    for (const [setter, key] of Object.entries({
        setNodes: "nodes",
        setConnections: "connections",
        setChatSessions: "chatSessions",
        setActiveChatId: "activeChatId",
        setBackgroundMode: "backgroundMode",
        setShowImageInfo: "showImageInfo",
        setProjectLoaded: "projectLoaded",
        setRunningNodeId: "runningNodeId",
        setHistoryState: "historyState",
        setViewport: "viewport",
        setSelectedNodeIds: "selectedNodeIds",
        setSelectedConnectionId: "selectedConnectionId",
        setContextMenu: "contextMenu",
        setToolbarNodeId: "toolbarNodeId",
    })) {
        c[setter] = (value: any) => {
            c[key] = typeof value === "function" ? value(c[key]) : value;
            if (c[key + "Ref"]) c[key + "Ref"].current = c[key];
            if (key === "nodes") c.documentNodes = c.getDocumentNodes(c.nodes);
        };
    }
    const context = vm.createContext(c);
    const run = (source: string) => vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, context);
    const bind = (name: string, body: string) => run(`globalThis.${name} = (${body});`);
    run(
        read("stores/canvas/use-canvas-store.ts")
            .replace(/^import[^\n]*\n/gm, "")
            .replace(/^export\s+/gm, "") + "\nglobalThis.store = useCanvasStore;",
    );
    c.updateProject = c.store.getState().updateProject;
    c.restoreSnapshot = c.store.getState().restoreSnapshot;
    run(declaration("lib/canvas/canvas-generation-helpers.ts", "resetInterruptedGeneration"));
    run(declaration("lib/canvas/canvas-node-factory.ts", "imageMetadata"));
    c.storedImageMetadata = c.imageMetadata;
    run(declaration("lib/canvas/canvas-generated-image.ts", "canvasImageMetadata"));
    c.imageMetadata = c.canvasImageMetadata;
    for (const statement of page.body.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
            if (decl.initializer && ts.isCallExpression(decl.initializer) && decl.initializer.expression.getText(project) === "useCallback") bind(decl.name.getText(project), decl.initializer.arguments[0].getText(project));
            if (decl.initializer && ["changeSelectionGroup", "insertMediaToolResult"].includes(decl.name.getText(project))) bind(decl.name.getText(project), decl.initializer.getText(project));
        }
    }
    run(
        read("lib/canvas/canvas-document-nodes.ts")
            .replace(/^import[^\n]*\n/gm, "")
            .replace(/^export\s+/gm, ""),
    );
    c.getDocumentNodes = c.createCanvasDocumentNodes();
    run(declaration("lib/canvas/canvas-generation-helpers.ts", "isGenerationCanceled"));
    bind("saveEffect", effect("updateProject(projectId, { nodes"));
    bind("historyEffect", effect("const next = createHistoryEntry();"));
    bind("cleanupEffect", effect("pendingImageUploadsRef.current.forEach"));
    const normalize = (value: any) => JSON.parse(JSON.stringify(value));
    const node = (metadata: any, x = 0) => ({ id: "same-node", type: "image", title: "Fixture", width: 320, height: 220, position: { x, y: 0 }, metadata });
    const install = (nodes: any[], snapshots: any[] = []) => {
        c.setNodes(nodes);
        c.store.setState({
            ownerUserId: "fixture-owner",
            projects: [{ id: c.projectId, title: "Fixture", nodes, connections: [], chatSessions: [], snapshots, activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }],
        });
    };
    const advance = (ms: number) => {
        const end = now + ms;
        for (;;) {
            const next = [...timers.entries()].filter(([, v]) => v.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
            if (!next) break;
            now = next[1].due;
            timers.delete(next[0]);
            next[1].run();
        }
        now = end;
    };
    return { c, run, bind, install, node, advance, writes, normalize };
}
const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("navigation detaches without DELETE and keeps a recoverable job", async () => {
    const { c, run, install, node, advance, writes } = harness();
    await flush();
    install([node({ status: "loading" })]);
    const canceled: string[] = [];
    let pollOptions: any;
    Object.assign(c, {
        deriveImageModelCapabilities: () => ({}),
        resolveSupportedImageQuality: () => "auto",
        resolveSupportedImageOutputFormat: () => "png",
        normalizeImageSizeSelection: (s: string) => s,
        validateImageRequest: () => {},
        normalizeResolution: () => "low",
        isUuAsyncGptImageModel: () => false,
        withSystemPrompt: (_: any, p: string) => p,
        normalizeBackground: () => "",
        submitImageJob: async () => ({ job: { id: "job-navigation" } }),
        cancelServerJob: async (id: string) => {
            canceled.push(id);
            return { job: { id, status: "canceled" } };
        },
        waitForServerJob: (_: string, options: any) => {
            pollOptions = options;
            return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
        },
    });
    run(declaration("services/api/image.ts", "requestServerImageJob"));
    const controller = c.startGenerationRequest("same-node", "same-node");
    const options = c.imageRequestOptions("same-node", controller);
    const request = c.requestServerImageJob({ channelId: "fixture-channel", model: "fixture-model", quality: "low", apiFormat: "openai", size: "auto" }, "fixture", [], undefined, 1, options).catch((e: Error) => e.name);
    await flush();
    assert.ok(pollOptions);
    c.saveEffect();
    advance(200);
    await flush();
    assert.equal(writes.at(-1).state.projects[0].nodes[0].metadata.jobId, "job-navigation");
    assert.match(read("router.tsx"), /<MeasuredRoute key=\{location.pathname\}/);
    c.cleanupEffect()(); // RoutePage's pathname key unmounts the old canvas.
    assert.equal(await request, "AbortError");
    assert.deepEqual(canceled, []);
    assert.equal(c.nodes[0].metadata.status, "loading");
});

test("snapshot restore invalidates an old recovery completion", async () => {
    const { c, install, node, advance, writes } = harness();
    await flush();
    const snapshot = {
        id: "snapshot-old",
        title: "Saved old image",
        nodes: [node({ status: "success", content: "snapshot-image", jobId: "snapshot-job" })],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
    install([node({ status: "loading", jobId: "job-inflight" })], [snapshot]);
    let options: any;
    const pending = Promise.withResolvers<any>();
    c.waitForServerJob = (_: string, value: any) => {
        options = value;
        return pending.promise;
    };
    c.completedServerImages = (job: any) => job.result.images;
    c.imageSaver = { retain: () => {}, prepare: async (image: any) => ({ url: image.dataUrl, storageKey: "", width: 1024, height: 1024, bytes: 1, mimeType: "image/png" }) };
    const controller = new AbortController();
    c.restoreAbortRef.current = controller;
    const recovery = c.resumeCanvasImageJob(c.nodes[0], controller.signal);
    c.handleRestoreSnapshot(snapshot);
    await c.confirm.onOk();
    assert.equal(c.nodes[0].metadata.content, "snapshot-image");
    assert.equal(controller.signal.aborted, true);
    options.onProgress({ jobId: "job-inflight", phase: "completed", reconnecting: false });
    assert.equal(c.nodes[0].metadata.content, "snapshot-image"); // Progress guard works.
    pending.resolve({ result: { images: [{ dataUrl: "late-result" }] } });
    await recovery;
    assert.equal(c.nodes[0].metadata.content, "snapshot-image");
    assert.equal(c.nodes[0].metadata.jobId, "snapshot-job");
    c.saveEffect();
    advance(200);
    await flush();
    assert.equal(writes.at(-1).state.projects[0].nodes[0].metadata.content, "snapshot-image");
});

test("phase changes preserve redo and stay out of persistence; real results still save", async () => {
    const { c, install, node, advance, writes } = harness();
    await flush();
    install([node({ status: "loading", jobId: "job-progress", generationProgress: { jobId: "job-progress", phase: "waiting_upstream", reconnecting: false } })]);
    const controller = c.startGenerationRequest("same-node", "same-node");
    const options = c.imageRequestOptions("same-node", controller);
    options.onProgress({ jobId: "job-progress", phase: "waiting_upstream", reconnecting: false });
    c.lastHistoryRef.current = c.createHistoryEntry();
    c.setNodes(c.nodes.map((n: any) => ({ ...n, position: { x: 100, y: 0 } })));
    c.historyEffect();
    advance(180); // Commit one actual user move.
    c.undoCanvas();
    advance(0);
    assert.equal(c.nodes[0].position.x, 0);
    assert.equal(c.historyRef.current.future.length, 1);
    assert.equal(c.historyState.canRedo, true);
    assert.equal(c.nodes[0].metadata.generationProgress.phase, "waiting_upstream");
    options.onProgress({ jobId: "job-progress", phase: "persisting", reconnecting: false });
    c.historyEffect();
    c.saveEffect();
    advance(200);
    await flush();
    assert.equal(c.nodes[0].position.x, 0);
    assert.equal(c.historyRef.current.future.length, 1);
    assert.equal(c.historyState.canRedo, true);
    assert.equal(writes.at(-1).state.projects[0].nodes[0].metadata.generationProgress, undefined);
    c.redoCanvas();
    advance(0);
    assert.equal(c.nodes[0].position.x, 100);
    assert.equal(c.nodes[0].metadata.generationProgress.phase, "persisting");
    c.setNodes(c.nodes.map((n: any) => ({ ...n, metadata: { ...n.metadata, content: "real-result", status: "success" } })));
    c.historyEffect();
    c.saveEffect();
    advance(200);
    await flush();
    assert.equal(writes.at(-1).state.projects[0].nodes[0].metadata.content, "real-result");
});

for (const action of ["group", "media"])
    test(`manual ${action} history commits exclude progress and preserve redo after undo`, async () => {
        const { c, run, install, node, advance } = harness();
        await flush();
        const source = { ...node({ status: "success", content: "source", storageKey: "source-key" }, 500), id: "source" };
        install([node({ status: "loading", jobId: "job", generationProgress: { jobId: "job", phase: "waiting_upstream", reconnecting: false } }), source]);
        c.lastHistoryRef.current = c.createHistoryEntry();
        if (action === "group") {
            run(
                read("lib/canvas/canvas-node-geometry.ts")
                    .replace(/^import[^\n]*\n/gm, "")
                    .replace(/^export\s+/gm, ""),
            );
            c.selectedNodeIdsRef = { current: new Set(["same-node", "source"]) };
            c.changeSelectionGroup(false);
        } else {
            c.mediaToolNode = source;
            c.toolSessionRef.current.canEdit = true;
            c.uploadMediaFile = async () => ({ url: "audio-result", storageKey: "audio-key" });
            c.createCanvasNode = (type: string, position: any, metadata: any) => ({ ...node(metadata), id: "audio", type, position });
            run(declaration("lib/canvas/canvas-node-factory.ts", "audioMetadata"));
            run(declaration("lib/canvas/media-result-position.ts", "mediaResultPosition"));
            await c.insertMediaToolResult(new File([], "result.wav"), "audio", new AbortController().signal);
        }
        // Move, then undo back to the manually committed document, leaving redo.
        c.setNodes(c.nodes.map((n: any) => ({ ...n, position: { ...n.position, x: n.position.x + 100 } })));
        c.historyEffect();
        advance(180);
        c.undoCanvas();
        advance(0);
        assert.equal(c.historyRef.current.future.length, 1);
        c.setNodes(c.nodes.map((n: any) => (n.id === "same-node" ? { ...n, metadata: { ...n.metadata, generationProgress: { jobId: "job", phase: "persisting", reconnecting: false } } } : n)));
        c.historyEffect();
        advance(200);
        assert.equal(c.historyRef.current.future.length, 1);
        assert.ok(c.lastHistoryRef.current.nodes.every((n: any) => !n.metadata?.generationProgress));
        assert.equal(c.historyState.canRedo, true);
    });

for (const fail of [false, true])
    test(`explicit stop ${fail ? "preserves recoverable task on DELETE failure" : "cancels the server task before detaching"}`, async () => {
        const { c, install, node } = harness();
        await flush();
        install([node({ status: "loading", jobId: "stop-job" })]);
        const controller = c.startGenerationRequest("same-node", "same-node");
        const options = c.imageRequestOptions("same-node", controller);
        options.onJobCreated("stop-job");
        const cancels: string[] = [];
        c.cancelServerJob = async (id: string) => {
            cancels.push(id);
            if (fail) throw Error("offline");
            return { job: { id, status: "canceled" } };
        };
        await c.stopGenerationByRunningId("same-node");
        assert.deepEqual(cancels, ["stop-job"]);
        assert.equal(controller.signal.aborted, !fail);
        assert.equal(c.nodes[0].metadata.status, fail ? "loading" : "idle");
        assert.equal(c.nodes[0].metadata.jobId, "stop-job");
        if (fail) assert.equal(c.errors.length, 1);
    });

test("snapshot restore rejects a fresh generation that already entered image preparation", async () => {
    const { c, install, node } = harness();
    await flush();
    const original = node({ status: "success", content: "snapshot-image" });
    const snapshot = { id: "snapshot", title: "Snapshot", nodes: [original], connections: [], chatSessions: [], backgroundMode: "lines", viewport: { x: 0, y: 0, k: 1 } };
    install([original], [snapshot]);
    const prepared = Promise.withResolvers<any>();
    Object.assign(c, {
        effectiveConfig: {},
        buildGenerationConfig: () => ({}),
        isAiConfigReady: () => true,
        getNodeDefinition: () => ({ useBuiltinPanel: { mode: "image", writeBackToSelf: true } }),
        requestGeneration: async () => [{ id: "new-image" }],
        imageSaver: { retain: () => {}, prepare: () => prepared.promise },
    });
    const generation = c.handleGenerateNode("same-node", "image", "New prompt");
    await flush();
    c.handleRestoreSnapshot(snapshot);
    await c.confirm.onOk();
    prepared.resolve({ url: "stale-image", storageKey: "", width: 100, height: 100 });
    await generation;
    assert.equal(c.nodes[0].metadata.content, "snapshot-image");
});

test("stop during submission waits for its ID, then explicitly cancels", async () => {
    const { c, install, node } = harness();
    await flush();
    install([node({ status: "loading" })]);
    const controller = c.startGenerationRequest("same-node", "same-node");
    const options = c.imageRequestOptions("same-node", controller);
    const canceled: string[] = [];
    c.cancelServerJob = async (id: string) => {
        canceled.push(id);
        return { job: { id, status: "canceled" } };
    };
    await c.stopGenerationByRunningId("same-node");
    assert.equal(controller.signal.aborted, false);
    options.onJobCreated("late-id");
    await flush();
    assert.deepEqual(canceled, ["late-id"]);
    assert.equal(controller.signal.aborted, true);
    assert.equal(c.nodes[0].metadata.status, "idle");
});

test("a progress update queued before restore cannot mutate the restored generation", async () => {
    const { c, install, node } = harness();
    await flush();
    install([node({ status: "loading", jobId: "same-job" })]);
    const controller = c.startGenerationRequest("same-node", "same-node");
    const options = c.imageRequestOptions("same-node", controller);
    const queue: any[] = [];
    const setNodes = c.setNodes;
    c.setNodes = (update: any) => queue.push(update);
    options.onProgress({ jobId: "same-job", phase: "persisting", reconnecting: false });
    c.invalidateGeneration();
    c.setNodes = setNodes;
    install([node({ status: "loading", jobId: "same-job", generationProgress: { phase: "queued" } })]);
    queue.forEach(setNodes);
    assert.equal(c.nodes[0].metadata.generationProgress.phase, "queued");
});

test("a direct provider request still stops locally without a server job", async () => {
    const { c, install, node } = harness();
    await flush();
    c.resolveModelRequestConfig = () => ({ channelId: "local-channel", serverManaged: false });
    c.PUBLIC_MODE = false;
    install([node({ status: "loading" })]);
    const controller = c.startGenerationRequest("same-node", "same-node");
    c.imageRequestOptions("same-node", controller);
    c.cancelServerJob = async () => {
        throw Error("No server job for direct requests");
    };
    await c.stopGenerationByRunningId("same-node");
    assert.equal(controller.signal.aborted, true);
    assert.equal(c.nodes[0].metadata.status, "idle");
});

test("partial batch cancellation preserves the failed slot and skips queued submissions", async () => {
    const { c, install, node } = harness();
    await flush();
    install(["one", "two", "queued"].map((id) => ({ ...node({ status: "loading" }), id })));
    const controller = c.startGenerationRequest("one", "one", "batch");
    c.startGenerationRequest("two", "one", "batch", controller);
    c.startGenerationRequest("queued", "one", "batch", controller);
    c.imageRequestOptions("one", controller).onJobCreated("job-one");
    c.imageRequestOptions("two", controller).onJobCreated("job-two");
    c.cancelServerJob = async (id: string) => {
        if (id === "job-two") throw Error("offline");
        return { job: { id, status: "canceled" } };
    };
    await c.stopGenerationByRunningId("batch");
    assert.equal(controller.signal.aborted, false);
    assert.equal(c.nodes.find((n: any) => n.id === "one").metadata.status, "idle");
    assert.equal(c.nodes.find((n: any) => n.id === "two").metadata.status, "loading");
    assert.throws(() => c.imageRequestOptions("queued", controller), /Aborted/);
});

test("late cancellation confirmation cannot clear a restored node", async () => {
    const { c, install, node } = harness();
    await flush();
    install([node({ status: "loading", jobId: "job" })]);
    const controller = c.startGenerationRequest("same-node", "same-node");
    c.imageRequestOptions("same-node", controller).onJobCreated("job");
    const response = Promise.withResolvers<any>();
    c.cancelServerJob = () => response.promise;
    const stopping = c.stopGenerationByRunningId("same-node");
    c.invalidateGeneration();
    install([node({ status: "loading", jobId: "restored-job" })]);
    response.resolve({ job: { id: "job", status: "canceled" } });
    await stopping;
    assert.equal(c.nodes[0].metadata.status, "loading");
    assert.equal(c.nodes[0].metadata.jobId, "restored-job");
});

test("restored watchers support explicit stop and keep their saved job identity", async () => {
    const { c, install, node } = harness();
    await flush();
    install([node({ status: "loading", jobId: "restored-job" })]);
    c.waitForServerJob = (_: string, options: any) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    const canceled: string[] = [];
    c.cancelServerJob = async (id: string) => {
        canceled.push(id);
        return { job: { id, status: "canceled" } };
    };
    const recovery = c.resumeCanvasImageJob(c.nodes[0], new AbortController().signal);
    await c.stopGenerationByRunningId("same-node");
    await recovery;
    assert.deepEqual(canceled, ["restored-job"]);
    assert.equal(c.nodes[0].metadata.status, "idle");
    assert.equal(c.nodes[0].metadata.jobId, "restored-job");
});

test("a running node saved in a snapshot resumes only that snapshot job", async () => {
    const { c, install, node } = harness();
    await flush();
    const snapshot = { id: "snapshot", title: "Snapshot", nodes: [node({ status: "loading", jobId: "snapshot-job" })], connections: [], chatSessions: [], backgroundMode: "lines", viewport: { x: 0, y: 0, k: 1 } };
    install([], [snapshot]);
    const jobs: string[] = [];
    c.waitForServerJob = async (id: string) => {
        jobs.push(id);
        return { result: { images: [{ dataUrl: "snapshot-result" }] } };
    };
    c.completedServerImages = (job: any) => job.result.images;
    c.imageSaver = { retain: () => {}, prepare: async (image: any) => ({ url: image.dataUrl, storageKey: "", width: 100, height: 100 }) };
    c.handleRestoreSnapshot(snapshot);
    await c.confirm.onOk();
    await flush();
    assert.deepEqual(jobs, ["snapshot-job"]);
    assert.equal(c.nodes[0].metadata.content, "snapshot-result");
    assert.equal(snapshot.nodes[0].metadata.status, "loading");
});
