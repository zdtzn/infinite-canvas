import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { shouldUploadLocalProject } from "./use-project-server-sync";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

function project(updatedAt: string, serverRevision?: number): CanvasProject {
    return {
        id: "project-1",
        title: "Project",
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt,
        ...(serverRevision === undefined ? {} : { serverRevision }),
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

describe("project server sync", () => {
    const remote = {
        project: project("2026-07-23T01:00:00.000Z"),
        revision: 4,
        updatedAt: Date.parse("2026-07-23T01:00:01.000Z"),
    };

    test("does not upload an unchanged project with the same revision", () => {
        assert.equal(shouldUploadLocalProject(project("2026-07-23T01:00:00.000Z", 4), remote, remote.project), false);
    });

    test("uploads an offline local edit with the same server revision", () => {
        assert.equal(shouldUploadLocalProject(project("2026-07-23T02:00:00.000Z", 4), remote, remote.project), true);
    });

    test("keeps the remote project when its revision is newer", () => {
        assert.equal(shouldUploadLocalProject(project("2026-07-23T03:00:00.000Z", 3), remote, remote.project), false);
    });
});
