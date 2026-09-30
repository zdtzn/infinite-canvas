import { shallow } from "zustand/shallow";
import type { CanvasNodeData } from "@/types/canvas";

// Progress belongs to the live view. Preserve document identity across phase-only
// updates so polling cannot create undo entries, clear redo, or dirty persistence.
export function createCanvasDocumentNodes() {
    let previous: CanvasNodeData[] = [];
    let source: CanvasNodeData[] | undefined;
    return (nodes: CanvasNodeData[]) => {
        if (nodes === source) return previous;
        source = nodes;
        const next = nodes.map((node, index) => {
            const old = previous[index];
            if (node === old) return old;
            const { generationProgress: _progress, ...metadata } = node.metadata || {};
            if (old && shallow({ ...node, metadata: undefined }, { ...old, metadata: undefined }) && shallow(metadata, old.metadata || {})) return old;
            return node.metadata && "generationProgress" in node.metadata ? { ...node, metadata } : node;
        });
        if (next.length === previous.length && next.every((node, index) => node === previous[index])) return previous;
        return (previous = next.every((node, index) => node === nodes[index]) ? nodes : next);
    };
}
