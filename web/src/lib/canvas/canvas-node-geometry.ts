import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle } from "@/types/canvas";

export function collectGroupMemberNodes(ids: Set<string>, nodes: CanvasNodeData[]) {
    const groups = new Set(nodes.filter((n) => ids.has(n.id) && n.type === CanvasNodeType.Group && !n.metadata?.locked).map((n) => n.id));
    const lockedGroups = new Set(nodes.filter((n) => n.type === CanvasNodeType.Group && n.metadata?.locked).map((n) => n.id));
    return nodes.filter((n) => n.type !== CanvasNodeType.Group && !n.metadata?.locked && !lockedGroups.has(n.metadata?.groupId || "") && (ids.has(n.id) || groups.has(n.metadata?.groupId || "")));
}

export function getGroupWrapRect(members: CanvasNodeData[]) {
    const b = nodeBounds(members);
    return { x: b.left - 24, y: b.top - 52, width: b.right - b.left + 48, height: b.bottom - b.top + 76 };
}

export function canGroupSelectedNodes(ids: Set<string>, nodes: CanvasNodeData[]) {
    const members = collectGroupMemberNodes(ids, nodes);
    return members.length >= 2 && (!members[0].metadata?.groupId || members.some((n) => n.metadata?.groupId !== members[0].metadata?.groupId));
}

export function canUngroupSelectedNodes(ids: Set<string>, nodes: CanvasNodeData[]) {
    return collectGroupMemberNodes(ids, nodes).some((n) => n.metadata?.groupId) || nodes.some((n) => ids.has(n.id) && n.type === CanvasNodeType.Group && !n.metadata?.locked && !nodes.some((child) => child.metadata?.groupId === n.id));
}

function finishGrouping(nodes: CanvasNodeData[], connections: CanvasConnection[], affected: Set<string>) {
    // Only groups touched by this operation may be removed. Locked members keep their group alive.
    const used = new Set(nodes.map((n) => n.metadata?.groupId));
    const removed = new Set(nodes.filter((n) => n.type === CanvasNodeType.Group && !n.metadata?.locked && affected.has(n.id) && !used.has(n.id)).map((n) => n.id));
    return { nodes: nodes.filter((n) => !removed.has(n.id)), connections: connections.filter((c) => !removed.has(c.fromNodeId) && !removed.has(c.toNodeId)) };
}

export function applyGroupSelection(ids: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[], group: CanvasNodeData) {
    if (!canGroupSelectedNodes(ids, nodes)) return null;
    const members = collectGroupMemberNodes(ids, nodes);
    const memberIds = new Set(members.map((n) => n.id));
    const affected = new Set(members.flatMap((n) => (n.metadata?.groupId ? [n.metadata.groupId] : [])));
    const next = finishGrouping([group, ...nodes.map((n) => (memberIds.has(n.id) ? { ...n, metadata: { ...n.metadata, groupId: group.id } } : n))], connections, affected);
    return { ...next, selectedIds: [group.id] };
}

export function applyUngroupSelection(ids: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    if (!canUngroupSelectedNodes(ids, nodes)) return null;
    const members = collectGroupMemberNodes(ids, nodes).filter((n) => n.metadata?.groupId);
    const memberIds = new Set(members.map((n) => n.id));
    const affected = new Set([...members.map((n) => n.metadata!.groupId!), ...nodes.filter((n) => ids.has(n.id) && n.type === CanvasNodeType.Group).map((n) => n.id)]);
    const next = finishGrouping(
        nodes.map((n) => (memberIds.has(n.id) ? { ...n, metadata: { ...n.metadata, groupId: undefined } } : n)),
        connections,
        affected,
    );
    return { ...next, selectedIds: next.nodes.filter((n) => ids.has(n.id) || memberIds.has(n.id)).map((n) => n.id) };
}

export function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

export function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return null;
    return (
        [...nodes].reverse().find((group) => {
            if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) return false;
            return movingNodes.some((node) => {
                const centerX = node.position.x + node.width / 2;
                const centerY = node.position.y + node.height / 2;
                return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
            });
        }) || null
    );
}

export function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const left = group.position.x + pad;
    const top = group.position.y + pad;
    const right = group.position.x + group.width - pad;
    const bottom = group.position.y + group.height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
    });
}

export function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return (
        [...nodes]
            .reverse()
            .find((group) => group.type === CanvasNodeType.Group && group.id !== node.id && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id ||
        undefined
    );
}

export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Group || second.type === CanvasNodeType.Group) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

export function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>, nodeById?: ReadonlyMap<string, CanvasNodeData>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodeById ? nodeById.get(rootId) : nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

export function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}
