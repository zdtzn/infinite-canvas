import type { CanvasNodeData, Position } from "@/types/canvas";

// Stack beside the source, skipping occupied rectangles (including connector space).
export function mediaResultPosition(source: CanvasNodeData, size: { width: number; height: number }, nodes: CanvasNodeData[]): Position {
    const x = source.position.x + source.width + 80;
    let y = source.position.y;
    const neighbors = nodes.filter((node) => !node.metadata?.hidden && node.type !== "group" && x < node.position.x + node.width + 32 && x + size.width + 32 > node.position.x).sort((a, b) => a.position.y - b.position.y);
    for (const node of neighbors) {
        if (y < node.position.y + node.height + 48 && y + size.height + 48 > node.position.y) y = node.position.y + node.height + 80;
    }
    return { x, y };
}
