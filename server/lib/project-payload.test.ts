import { describe, expect, test } from "bun:test";

import { isSafeRecordId, isValidProjectPayload } from "./project-payload";

describe("project payload validation", () => {
    const project = {
        id: "project-1",
        title: "画布",
        nodes: [{ id: "node-1" }, { id: "node-2" }],
        connections: [{ id: "connection-1", fromNodeId: "node-1", toNodeId: "node-2" }],
    };

    test("accepts stable project graphs", () => {
        expect(isValidProjectPayload(project, "project-1")).toBe(true);
    });

    test("rejects prototype keys, duplicate ids, and dangling connections", () => {
        expect(isSafeRecordId("__proto__")).toBe(false);
        expect(isValidProjectPayload({ ...project, id: "__proto__" }, "__proto__")).toBe(false);
        expect(isValidProjectPayload({ ...project, nodes: [{ id: "node-1" }, { id: "node-1" }] }, "project-1")).toBe(false);
        expect(isValidProjectPayload({ ...project, connections: [{ id: "connection-1", fromNodeId: "missing", toNodeId: "node-2" }] }, "project-1")).toBe(false);
    });
});
