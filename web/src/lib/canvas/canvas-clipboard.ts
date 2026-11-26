import { nanoid } from "nanoid";
import type { CanvasConnection, CanvasNodeMetadata } from "@/types/canvas";

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

export function copiedCanvasMetadata(metadata: CanvasNodeMetadata | undefined, idMap: ReadonlyMap<string, string>): CanvasNodeMetadata | undefined {
    if (!metadata) return undefined;
    const childIds = metadata.batchChildIds?.flatMap((id) => idMap.has(id) ? [idMap.get(id)!] : []);
    const isBatchRoot = Boolean(metadata.isBatchRoot && childIds?.length);
    return {
        ...metadata,
        groupId: metadata.groupId && idMap.get(metadata.groupId),
        composerContent: metadata.composerContent === undefined ? undefined : remapCanvasNodeReferences(metadata.composerContent, idMap),
        batchRootId: metadata.batchRootId && idMap.get(metadata.batchRootId),
        isBatchRoot: isBatchRoot || undefined,
        batchChildIds: isBatchRoot ? childIds : undefined,
        primaryImageId: metadata.primaryImageId && idMap.get(metadata.primaryImageId),
        imageBatchExpanded: isBatchRoot ? metadata.imageBatchExpanded : undefined,
        variantGroupId: metadata.variantGroupId && (idMap.get(metadata.variantGroupId) || metadata.variantGroupId),
        jobId: undefined, imageSubmissionParent: undefined, videoTask: undefined, videoTaskBinding: undefined, generationProgress: undefined,
        status: metadata.status === "loading" ? (metadata.content ? "success" : "idle") : metadata.status,
    };
}
