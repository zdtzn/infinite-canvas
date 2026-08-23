import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeCanvasProject, useCanvasStore } from "./use-canvas-store";

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
