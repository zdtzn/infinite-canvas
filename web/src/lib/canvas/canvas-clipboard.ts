import { nanoid } from "nanoid";
import type { CanvasConnection } from "@/types/canvas";

export function remapCanvasNodeReferences(content: string, idMap: ReadonlyMap<string, string>): string {
    return content.replace(/@\[node:([^\]]+)\]/g, (token, nodeId: string) => idMap.has(nodeId) ? `@[node:${idMap.get(nodeId)}]` : token);
}

// 内部引用改指副本，外部输入保留原来源；已删除的来源不能生成悬空连线。
export function copyInboundConnections(connections: CanvasConnection[], idMap: ReadonlyMap<string, string>, existingNodeIds: ReadonlySet<string>): CanvasConnection[] {
    return connections.flatMap((connection) => {
        const toNodeId = idMap.get(connection.toNodeId);
        const fromNodeId = idMap.get(connection.fromNodeId) ?? connection.fromNodeId;
        if (!toNodeId || (!idMap.has(connection.fromNodeId) && !existingNodeIds.has(fromNodeId))) return [];
        return [{ ...connection, id: nanoid(), fromNodeId, toNodeId }];
    });
}
