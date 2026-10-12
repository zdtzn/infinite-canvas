import { expect, test } from "bun:test";
import { copyInboundConnections } from "./canvas-clipboard";
import type { CanvasConnection } from "@/types/canvas";

const link = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

test("copying a generation node retains its external image and config inputs without copying outputs", () => {
    const connections = [link("image", "result"), link("config", "result"), link("result", "downstream")];
    const copied = copyInboundConnections(connections, new Map([["result", "copy"]]), new Set(["image", "config", "result", "downstream"]));
    expect(copied.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual([["image", "copy"], ["config", "copy"]]);
    expect(copied.every((connection) => !connections.some((original) => original.id === connection.id))).toBe(true);
    expect(connections[0].toNodeId).toBe("result");
});

test("multi-node paste binds internal references to copies and drops external sources deleted since copying", () => {
    const copied = copyInboundConnections([link("a", "b"), link("external", "b"), link("deleted", "b")], new Map([["a", "new-a"], ["b", "new-b"]]), new Set(["external"]));
    expect(copied.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual([["new-a", "new-b"], ["external", "new-b"]]);
});
