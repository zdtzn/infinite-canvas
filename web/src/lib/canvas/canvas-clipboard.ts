import { nanoid } from "nanoid";
import type { CanvasConnection } from "@/types/canvas";

// 内部引用改指副本，外部输入保留原来源；已删除的来源不能生成悬空连线。
export function copyInboundConnections(connections: CanvasConnection[], idMap: ReadonlyMap<string, string>, existingNodeIds: ReadonlySet<string>): CanvasConnection[] {
    return connections.flatMap((connection) => {
        const toNodeId = idMap.get(connection.toNodeId);
        const fromNodeId = idMap.get(connection.fromNodeId) ?? connection.fromNodeId;
        if (!toNodeId || (!idMap.has(connection.fromNodeId) && !existingNodeIds.has(fromNodeId))) return [];
        return [{ ...connection, id: nanoid(), fromNodeId, toNodeId }];
    });
}
