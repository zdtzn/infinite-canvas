import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeCanvasProject } from "./use-canvas-store";

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
});
