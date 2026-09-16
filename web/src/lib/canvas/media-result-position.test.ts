import { expect, test } from "bun:test";
import type { CanvasNodeData } from "@/types/canvas";
import { mediaResultPosition } from "./media-result-position";
const source: CanvasNodeData = { id: "video", type: "video", title: "source", position: { x: 0, y: 0 }, width: 320, height: 240 };
test("derived media keeps its preferred position when free and skips occupied slots", () => {
    const size = { width: 480, height: 360 };
    expect(mediaResultPosition(source, size, [source])).toEqual({ x: 400, y: 0 });
    const occupied = { ...source, id: "image", position: { x: 600, y: 0 } };
    const lower = { ...occupied, id: "lower", position: { x: 500, y: 350 } };
    expect(mediaResultPosition(source, size, [lower, source, occupied])).toEqual({ x: 400, y: 670 });
    expect(mediaResultPosition(source, size, [{ ...occupied, metadata: { hidden: true } }])).toEqual({ x: 400, y: 0 });
});
