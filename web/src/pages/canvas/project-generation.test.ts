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
        NODE_DEFAULT_SIZE: { image: { width: 340, height: 240 } },
        fetchCanvasJobReceipt: async () => ({ idempotencyKey: "fixture-receipt", jobId: null }),
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
    for (const name of ["imageSaveState", "canvasImageResourceMetadata", "reconcileCanvasBatch"]) run(declaration("lib/canvas/canvas-generated-image.ts", name));
    run(declaration("lib/canvas/canvas-node-size.ts", "fitNodeSize"));
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
    run(declaration("services/api/image.ts", "waitForServerImageJob"));
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

test("retrying a failed canvas node with a job ID uses its retry endpoint even without local references", async () => {
    const { c, run, install, node } = harness();
    const paths: string[] = [];
    install([node({ status: "error", jobId: "original-job", generationType: "edit", prompt: "fixture", model: "fixture-model" })]);
    Object.assign(c, {
        effectiveConfig: {}, imageSaveState: () => null, isImageSubmissionUnconfirmed: () => false,
        findRetrySourceNode: () => c.nodes[0], applyCameraPrompt: (text: string) => text,
        isAiConfigReady: () => assert.fail("The retry must use the original server model"),
        resolveMetadataReferences: () => assert.fail("The retry must use the original server references"),
        serverRequest: async (path: string) => {
            paths.push(path);
            if (path === "/api/jobs/original-job") return { job: { id: "original-job", status: "failed" } };
            return { job: { id: "resumed-job" } };
        },
        waitForServerJob: async (id: string) => {
            assert.equal(id, "resumed-job");
            throw new DOMException("Aborted", "AbortError");
        },
    });
    for (const operation of ["fetchServerJob", "retryServerJob"]) run(declaration("services/server-api.ts", operation));
    run(declaration("services/api/image.ts", "retryServerImageJob"));
    run(declaration("services/api/image.ts", "waitForServerImageJob"));
    await c.handleRetryNode(c.nodes[0]);
    assert.deepEqual(paths, ["/api/jobs/original-job", "/api/jobs/original-job/retry"]);
    assert.equal(c.nodes[0].metadata.jobId, "resumed-job");
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
    let preparationStarted = false;
    Object.assign(c, {
        effectiveConfig: {},
        buildGenerationConfig: () => ({}),
        isAiConfigReady: () => true,
        getNodeDefinition: () => ({ useBuiltinPanel: { mode: "image", writeBackToSelf: true } }),
        buildNodeGenerationContext: (...args: any[]) => ({ prompt: args[3], referenceImages: [] }),
        resolveImageModelSettings: () => ({ capabilities: { maxReferences: 1 } }),
        hydrateNodeGenerationContext: async (context: any) => context,
        requestGeneration: async () => [{ id: "new-image" }],
        imageSaver: { retain: () => {}, prepare: () => { preparationStarted = true; return prepared.promise; } },
    });
    const generation = c.handleGenerateNode("same-node", "image", "New prompt");
    await flush();
    assert.equal(preparationStarted, true);
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

function batchFixture(limit = 2) {
    const h = harness(), { c, run } = h;
    const noop = () => {};
    let sequence = 0;
    const requests: Array<{ id: string; options: any; finish: () => void }> = [];
    const canceled: string[] = [];
    Object.assign(c, {
        nanoid: () => `node-${++sequence}`, effectiveConfig: { model: "model", count: "2" }, buildGenerationConfig: (cfg: any) => cfg,
        isAiConfigReady: () => true, getNodeDefinition: () => null, buildNodeGenerationContext: (_id: string, _ns: any, _cs: any, prompt: string) => ({ prompt, referenceImages: [] }),
        hydrateNodeGenerationContext: async (ctx: any) => ctx, applyCameraPrompt: (p: string) => p,
        resolveImageModelSettings: () => ({ capabilities: { maxReferences: 4 }, channel: { baseUrl: "fixture" } }),
        buildImageGenerationMetadata: () => ({ generationType: "generation" }), normalizeCameraSettings: noop,
        cultivationProfile: {}, resolveImageSlotConcurrency: () => limit, queryClient: { invalidateQueries: noop }, cultivationProfileQueryKey: [], isDouEmperor: false,
        imageSaver: { prepare: async (img: any) => ({ url: img.dataUrl, storageKey: "asset", width: 2048, height: 1536 }) },
        requestGeneration: (_cfg: any, _prompt: string, options: any) => {
            const id = `job-${requests.length + 1}`, result = Promise.withResolvers<any[]>();
            requests.push({ id, options, finish: () => result.resolve([{ dataUrl: id }]) });
            options.onJobCreated(id);
            return result.promise;
        },
        cancelServerJob: async (id: string) => { canceled.push(id); return { job: { id, status: "canceled" } }; },
        referenceSelectionRef: { current: null }, cancelPendingConnectionCreate: noop, cleanupAssetImages: noop,
    });
    for (const name of ["setMaskEditNodeId", "setHoveredNodeId", "setEditingNodeId", "setInfoNodeId", "setCropNodeId", "setAngleNodeId", "setPreviewNodeId", "setClearConfirmOpen", "setSelectionBox"]) c[name] = noop;
    for (const name of ["copiedCanvasMetadata", "remapCanvasNodeReferences", "copyInboundConnections"]) run(declaration("lib/canvas/canvas-clipboard.ts", name));
    run(declaration("lib/async-pool.ts", "runWithConcurrency"));
    run(declaration("lib/canvas/canvas-generation-helpers.ts", "getGenerationCount"));
    h.install([h.node({ status: "idle" })]);
    return { ...h, requests, canceled, start: () => c.handleGenerateNode("same-node", "image", "test") };
}

test("duplicating and deleting a batch leaves the original children and links intact", async () => {
    const { c, requests, start } = batchFixture();
    const done = start();
    await flush();
    requests.forEach((req) => req.finish());
    await done;
    const original = c.nodes.find((n: any) => n.metadata.isBatchRoot);
    c.duplicateNode(original.id);
    const copy = c.nodes.find((n: any) => n.metadata.isBatchRoot && n.id !== original.id);
    assert.equal(copy.metadata.batchChildIds.length, 2);
    assert.ok(copy.metadata.batchChildIds.every((id: string) => !original.metadata.batchChildIds.includes(id)));
    c.deleteNodes(new Set([copy.id]));
    assert.equal(c.nodes.length, 3);
    assert.equal(c.connections.length, 2);
    assert.ok(c.nodes.filter((n: any) => n.id !== original.id).every((n: any) => n.metadata.batchRootId === original.id && n.metadata.content));
});

test("clearing while the first slot runs cancels it and never dispatches the queued slot", async () => {
    const { c, start, requests, canceled } = batchFixture(1);
    const done = start();
    await flush();
    assert.equal(requests.length, 1);
    c.clearCanvas();
    requests[0].finish();
    await done;
    assert.deepEqual(canceled, ["job-1"]);
    assert.equal(requests.length, 1);
    assert.equal(c.nodes.length, 0);
});

test("deleting one running batch slot leaves its sibling live and shows its result", async () => {
    const { c, start, requests, canceled } = batchFixture();
    const done = start();
    await flush();
    c.deleteNodes(new Set([c.nodes.find((n: any) => n.metadata.jobId === "job-1").id]));
    assert.equal(requests[1].options.signal.aborted, false);
    requests.forEach((req) => req.finish());
    await done;
    assert.deepEqual(canceled, ["job-1"]);
    assert.ok(c.nodes.every((n: any) => n.metadata.status === "success" && n.metadata.content === "job-2"));
});

test("reopening a submitted batch restores the cover and fits the result to the original layout", async () => {
    const { c, start, requests } = batchFixture();
    const done = start();
    await flush();
    const document = structuredClone(c.getDocumentNodes(c.nodes));
    requests.forEach((req) => req.finish());
    await done;
    const reopened = batchFixture(), next = reopened.c;
    next.waitForServerJob = async (id: string) => ({ result: { images: [{ dataUrl: id }] } });
    next.completedServerImages = (job: any) => job.result.images;
    reopened.install(next.resetInterruptedGeneration(document));
    for (const node of next.nodes.filter((n: any) => n.metadata.jobId)) await next.resumeCanvasImageJob(node, new AbortController().signal);
    for (const item of next.nodes) {
        const original = c.nodes.find((n: any) => n.id === item.id);
        assert.equal(item.metadata.status, "success");
        assert.equal(item.metadata.content, original.metadata.content);
        assert.deepEqual([item.width, item.height, item.position.x, item.position.y], [original.width, original.height, original.position.x, original.position.y]);
    }
});

test("panorama completion releases its generate button", async () => {
    const { c, start, requests } = batchFixture();
    c.getNodeDefinition = () => ({ useBuiltinPanel: { mode: "image", writeBackToSelf: true } });
    const done = start();
    await flush();
    requests[0].finish();
    await done;
    assert.equal(c.nodes[0].metadata.status, "success");
    assert.equal(c.runningNodeId, null);
});

test("a submission accepted before refresh is recovered by its receipt without a second submit", async () => {
    const first = batchFixture(), { c } = first;
    const ledger = new Map<string, string>();
    const receipt = async (project: string, node: string, parent: string) => {
        const key = JSON.stringify([project, node, parent]);
        return { idempotencyKey: key, jobId: ledger.get(key) || null };
    };
    c.fetchCanvasJobReceipt = receipt;
    c.effectiveConfig.count = "1";
    const response = Promise.withResolvers<void>();
    let submissions = 0;
    c.requestGeneration = async (_cfg: any, _p: string, options: any) => {
        const { idempotencyKey } = await options.getCanvasReceipt();
        ledger.set(idempotencyKey, "accepted");
        submissions++;
        await response.promise;
        options.onJobCreated("accepted");
        return [{ dataUrl: "result" }];
    };
    const done = first.start();
    await flush();
    c.saveEffect(); first.advance(200); await flush();
    const document = first.writes.at(-1).state.projects[0].nodes;
    assert.equal(document[0].metadata.jobId, undefined);
    assert.equal(document[0].metadata.imageSubmissionParent, "");
    c.cleanupEffect()();
    response.resolve(); await done;
    const next = batchFixture();
    next.c.fetchCanvasJobReceipt = receipt;
    next.c.waitForServerJob = async (id: string) => { assert.equal(id, "accepted"); return { result: { images: [{ dataUrl: "result" }] } }; };
    next.c.completedServerImages = (job: any) => job.result.images;
    next.install(next.c.resetInterruptedGeneration(document));
    await next.c.resumeCanvasImageJob(next.c.nodes[0], new AbortController().signal);
    assert.equal(next.c.nodes[0].metadata.content, "result");
    assert.equal(submissions, 1);
});
