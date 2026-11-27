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

    test("persists a canvas plugin node and a connection to the generated image", () => {
        const nodeId = "director:studio-123-abcd";
        const graph = { ...project, nodes: [{ id: nodeId, type: "director:studio" }, { id: "shot-1", type: "image" }], connections: [{ id: "link-1", fromNodeId: nodeId, toNodeId: "shot-1" }] };
        expect(isValidProjectPayload(graph, graph.id)).toBe(true);
        expect(isSafeRecordId(nodeId)).toBe(false);
        expect(isValidProjectPayload({ ...graph, nodes: [{ id: "director:../studio" }], connections: [] }, graph.id)).toBe(false);
    });

    test("rejects prototype keys, duplicate ids, and dangling connections", () => {
        expect(isSafeRecordId("__proto__")).toBe(false);
        expect(isValidProjectPayload({ ...project, id: "__proto__" }, "__proto__")).toBe(false);
        expect(isValidProjectPayload({ ...project, nodes: [{ id: "node-1" }, { id: "node-1" }] }, "project-1")).toBe(false);
        expect(isValidProjectPayload({ ...project, connections: [{ id: "connection-1", fromNodeId: "missing", toNodeId: "node-2" }] }, "project-1")).toBe(false);
    });
});
