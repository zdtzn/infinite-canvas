import { expect, test } from "bun:test";
import { createCanvasResourceCache } from "./canvas-resource-cache";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const image: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "source", position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: "old.png" } };
const config: CanvasNodeData = { ...image, id: "config", type: CanvasNodeType.Config, metadata: {} };
const edges = [{ id: "edge", fromNodeId: image.id, toNodeId: config.id }];

test("reuses both derivations for repeated position/dimension changes and cloned edges", () => {
    const cache = createCanvasResourceCache();
    const first = cache([image, config], edges);
    for (let i = 0; i < 30; i++) {
        expect(
            cache(
                [{ ...image, position: { x: i, y: i }, width: 300 + i, height: 300 }, config],
                edges.map((edge) => ({ ...edge })),
            ),
        ).toBe(first);
    }
    expect(first.configInputsById.get("config")?.[0].image?.dataUrl).toBe("old.png");
});

test("metadata, title, type, membership and registry changes invalidate", () => {
    for (const change of [
        { ...image, metadata: { content: "new.png" } },
        { ...image, title: "renamed" },
        { ...image, type: CanvasNodeType.Text },
        { ...image, id: "replacement" },
    ]) {
        const cache = createCanvasResourceCache();
        const first = cache([image, config], edges);
        expect(cache([change, config], edges)).not.toBe(first);
    }
    const cache = createCanvasResourceCache();
    const first = cache([image, config], edges);
    const changed = cache([{ ...image, metadata: { content: "new.png" } }, config], edges);
    expect(changed.configInputsById.get("config")?.[0].image?.dataUrl).toBe("new.png");
    expect(changed.mentionReferencesByNodeId.get("config")?.[0].previewUrl).toBe("new.png");
    expect(cache([image], edges)).not.toBe(first);
    expect(cache([image, config], edges, 1)).not.toBe(first);
});

test("rewiring, removal and connection order refresh references", () => {
    const other = { ...image, id: "other", title: "other" };
    const nodes = [image, other, config];
    const connections = [...edges, { id: "second", fromNodeId: other.id, toNodeId: config.id }];
    const cache = createCanvasResourceCache();
    const first = cache(nodes, connections);
    const reordered = cache(nodes, [...connections].reverse());
    expect(reordered).not.toBe(first);
    expect(reordered.configInputsById.get("config")?.map((input) => input.nodeId)).toEqual(["other", "image"]);
    expect(cache(nodes, []).configInputsById.get("config")).toEqual([]);
    expect(cache(nodes, [{ ...edges[0], fromNodeId: other.id }]).configInputsById.get("config")?.[0].nodeId).toBe("other");
});

test("plugin nodes conservatively invalidate on geometry changes", () => {
    const cache = createCanvasResourceCache();
    const plugin = { ...image, type: "plugin:resource" };
    const first = cache([plugin, config], edges);
    expect(cache([{ ...plugin, width: 400 }, config], edges)).not.toBe(first);
});
