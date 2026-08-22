import type { CanvasNodeData } from "../../types/canvas";

export function shouldStartCanvasPan({ button, isBackgroundClick, isSpacePressed }: { button: number; isBackgroundClick: boolean; isSpacePressed: boolean }) {
    return button === 1 || (button === 0 && (isBackgroundClick || isSpacePressed));
}

export function shouldDeselectAfterCanvasPan({ hasMoved, startedOnBackground }: { hasMoved: boolean; startedOnBackground: boolean }) {
    return !hasMoved && startedOnBackground;
}

export function collectMovableCanvasNodeIds(nodes: CanvasNodeData[], selectedNodeIds: Iterable<string>) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const movable = new Set<string>();

    for (const nodeId of selectedNodeIds) {
        const node = nodeById.get(nodeId);
        if (!node || node.metadata?.locked) continue;
        movable.add(node.id);
        for (const childId of node.metadata?.batchChildIds || []) {
            if (!nodeById.get(childId)?.metadata?.locked) movable.add(childId);
        }
        if (node.type === "group") {
            for (const child of nodes) {
                if (child.metadata?.groupId === node.id && !child.metadata?.locked) movable.add(child.id);
            }
        }
    }

    return movable;
}
