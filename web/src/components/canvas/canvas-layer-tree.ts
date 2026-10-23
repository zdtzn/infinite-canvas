import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasLayerRow = { node: CanvasNodeData; depth: number; hasChildren: boolean; collapsed: boolean };

export function buildCanvasLayerRows(nodes: CanvasNodeData[], filtered: CanvasNodeData[], collapsedGroups: ReadonlySet<string>, expandMatches = false): CanvasLayerRow[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const parentById = new Map<string, string>();
    for (const node of nodeById.values()) {
        const groupId = node.metadata?.groupId;
        if (groupId && groupId !== node.id && nodeById.get(groupId)?.type === CanvasNodeType.Group) parentById.set(node.id, groupId);
    }
    const included = new Set(filtered.map((node) => node.id));
    for (const node of filtered) {
        let parentId = parentById.get(node.id);
        const ancestors = new Set([node.id]);
        while (parentId && !ancestors.has(parentId)) {
            ancestors.add(parentId);
            included.add(parentId);
            parentId = parentById.get(parentId);
        }
    }
    const children = new Map<string, CanvasNodeData[]>();
    for (const node of nodeById.values()) {
        const parentId = parentById.get(node.id);
        if (!included.has(node.id) || !parentId) continue;
        const siblings = children.get(parentId) || [];
        siblings.push(node);
        children.set(parentId, siblings);
    }
    const rows: CanvasLayerRow[] = [];
    const visited = new Set<string>();
    const visit = (node: CanvasNodeData, depth: number, hidden = false) => {
        if (visited.has(node.id) || !included.has(node.id)) return;
        visited.add(node.id);
        const members = children.get(node.id) || [];
        const collapsed = !expandMatches && collapsedGroups.has(node.id);
        if (!hidden) rows.push({ node, depth, hasChildren: members.length > 0, collapsed });
        for (const child of members) visit(child, depth + 1, hidden || collapsed);
    };
    for (const node of nodeById.values()) {
        if (!parentById.has(node.id)) visit(node, 0);
    }
    // Imported or partially edited groups must not make their nodes disappear.
    for (const node of nodeById.values()) visit(node, 0);
    return rows;
}
