import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canvasProjectAvailability, normalizeCanvasProject, useCanvasStore } from "./use-canvas-store";

describe("canvas deep link entry", () => {
    const empty = { hydrated: true, ownerUserId: "alice", projects: [], serverProjectsStatus: null };
    const ready = { userId: "alice", status: "ready" as const };
    const project = normalizeCanvasProject({ id: "cloud-canvas" })!;

    test("waits for the authenticated cloud list before deciding a missing local project is gone", () => {
        assert.equal(canvasProjectAvailability(empty, project.id, "alice"), "loading");
        assert.equal(canvasProjectAvailability({ ...empty, projects: [project], serverProjectsStatus: ready }, project.id, "alice"), "available");
        assert.equal(canvasProjectAvailability({ ...empty, serverProjectsStatus: ready }, project.id, "alice"), "missing");
    });

    test("distinguishes a network failure from absence and still opens a cached project", () => {
        const offline = { ...empty, serverProjectsStatus: { userId: "alice", status: "error" as const } };
        assert.equal(canvasProjectAvailability(offline, project.id, "alice"), "error");
        assert.equal(canvasProjectAvailability({ ...offline, projects: [project] }, project.id, "alice"), "available");
        assert.equal(canvasProjectAvailability(empty, project.id), "missing");
    });

    test("never uses another account's cache or cloud lookup result", () => {
        assert.equal(canvasProjectAvailability({ ...empty, projects: [project], serverProjectsStatus: ready }, project.id, "bob"), "loading");
        assert.equal(canvasProjectAvailability({ ...empty, ownerUserId: "bob", serverProjectsStatus: ready }, project.id, "bob"), "loading");
        assert.equal(canvasProjectAvailability({ ...empty, serverProjectsStatus: ready }, project.id, ""), "loading");
    });
});

describe("canvas project schema migration", () => {
    test("fills required fields for legacy or server-restored projects", () => {
        const project = normalizeCanvasProject({
            id: "legacy-project",
            title: "Legacy",
            nodes: [{ id: "node-1", metadata: { content: "/api/assets/image%3Atest" } }],
            connections: [],
        });

        assert.deepEqual(project?.viewport, { x: 0, y: 0, k: 1 });
        assert.deepEqual(project?.nodes[0]?.position, { x: 0, y: 0 });
        assert.equal(project?.nodes[0]?.width, 320);
        assert.deepEqual(project?.chatSessions, []);
        assert.equal(project?.backgroundMode, "lines");
    });

    test("rejects records without a stable project id", () => {
        assert.equal(normalizeCanvasProject({ nodes: [], connections: [] }), null);
    });

    test("keeps projects for the same account and clears them before another account is prepared", () => {
        const project = normalizeCanvasProject({ id: "private-a", nodes: [], connections: [] });
        assert.ok(project);
        useCanvasStore.setState({ hydrated: true, ownerUserId: "user-a", projects: [project] });

        useCanvasStore.getState().prepareForUser("user-a");
        assert.equal(useCanvasStore.getState().projects.length, 1);

        useCanvasStore.getState().prepareForUser("user-b");
        assert.equal(useCanvasStore.getState().ownerUserId, "user-b");
        assert.deepEqual(useCanvasStore.getState().projects, []);
    });

    test("assigns legacy browser projects to the first authenticated account once", () => {
        const project = normalizeCanvasProject({ id: "legacy-private", nodes: [], connections: [] });
        assert.ok(project);
        useCanvasStore.setState({ hydrated: true, ownerUserId: "", projects: [project] });

        useCanvasStore.getState().prepareForUser("first-user");

        assert.equal(useCanvasStore.getState().ownerUserId, "first-user");
        assert.equal(useCanvasStore.getState().projects[0]?.id, "legacy-private");
    });

    test("keeps the newest twelve snapshots and restores project content without deleting snapshots", () => {
        const project = normalizeCanvasProject({ id: "snapshot-project", nodes: [], connections: [] });
        assert.ok(project);
        useCanvasStore.setState({ hydrated: true, ownerUserId: "snapshot-user", projects: [project] });

        for (let index = 0; index < 13; index += 1) {
            useCanvasStore.getState().createSnapshot("snapshot-project", {
                title: `版本 ${index + 1}`,
                nodes: [{ id: `text-${index}`, type: "text", title: `版本 ${index + 1}`, position: { x: index, y: index }, width: 320, height: 220, metadata: { content: String(index) } }],
                connections: [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: "lines",
                showImageInfo: false,
                viewport: { x: index, y: index, k: 1 },
            });
        }

        const beforeRestore = useCanvasStore.getState().projects[0];
        assert.ok(beforeRestore);
        assert.equal(beforeRestore.snapshots.length, 12);
        assert.equal(beforeRestore.snapshots[0]?.title, "版本 13");
        const oldestSnapshot = beforeRestore.snapshots[11];
        assert.ok(oldestSnapshot);

        const restored = useCanvasStore.getState().restoreSnapshot("snapshot-project", oldestSnapshot.id);
        assert.equal(restored?.title, "版本 2");
        const afterRestore = useCanvasStore.getState().projects[0];
        assert.equal(afterRestore?.nodes[0]?.metadata?.content, "1");
        assert.equal(afterRestore?.snapshots.length, 12);
    });
});

describe("canvas saving", () => {
    test("an earlier upload acknowledgment advances the revision without marking a newer edit as saved", () => {
        const before = useCanvasStore.getState();
        try {
            const project = normalizeCanvasProject({ id: "editing", title: "first", serverRevision: 4, pendingSync: true })!;
            useCanvasStore.setState({ projects: [project] });
            useCanvasStore.getState().renameProject(project.id, "second");
            useCanvasStore.getState().setProjectServerRevision(project, 5);
            const draft = useCanvasStore.getState().openProject(project.id)!;
            assert.equal(draft.title, "second");
            assert.equal(draft.serverRevision, 5);
            assert.equal(draft.pendingSync, true);
            useCanvasStore.getState().setProjectServerRevision(draft, 6);
            assert.equal(useCanvasStore.getState().openProject(project.id)?.pendingSync, false);
        } finally {
            useCanvasStore.setState(before);
        }
    });

    test("account changes preserve only that account's unsynced drafts", () => {
        const before = useCanvasStore.getState();
        try {
            const clean = normalizeCanvasProject({ id: "clean", serverRevision: 7, pendingSync: false })!;
            const draft = normalizeCanvasProject({ id: "draft", title: "offline edit", serverRevision: 4, pendingSync: true })!;
            useCanvasStore.setState({ ownerUserId: "draft-user-a", projects: [clean, draft], pendingProjectsByUser: {} });
            useCanvasStore.getState().prepareForUser("draft-user-b");
            assert.equal(useCanvasStore.getState().projects.length, 0);
            useCanvasStore.getState().prepareForUser("draft-user-a");
            assert.deepEqual(useCanvasStore.getState().projects, [draft]);
        } finally {
            useCanvasStore.setState(before);
        }
    });

    test("applying a different document reloads only that editor and sync acknowledgments do not reload it", () => {
        const before = useCanvasStore.getState();
        try {
            const first = normalizeCanvasProject({ id: "changed", title: "old" })!;
            const second = normalizeCanvasProject({ id: "untouched" })!;
            useCanvasStore.setState({ projects: [first, second], projectReloads: new Map(), deletedProjects: [] });
            useCanvasStore.getState().replaceProjects([{ ...first, title: "cloud" }, second]);
            assert.equal(useCanvasStore.getState().projectReloads.get(first.id), 1);
            assert.equal(useCanvasStore.getState().projectReloads.has(second.id), false);
            useCanvasStore.getState().setProjectServerRevision(useCanvasStore.getState().openProject(first.id)!, 1);
            assert.equal(useCanvasStore.getState().projectReloads.get(first.id), 1);
        } finally {
            useCanvasStore.setState(before);
        }
    });
});
