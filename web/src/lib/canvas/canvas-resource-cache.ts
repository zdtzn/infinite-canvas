import { buildCanvasResourceIndex, buildNodeMentionReferences } from "./canvas-resource-references";
import { buildNodeGenerationInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { isBuiltinNodeType } from "./node-registry";

// Canvas updates are immutable. Geometry is deliberately excluded; resource readers
// use id/type/title/metadata. Connection order determines reference numbering.
export function createCanvasResourceCache() {
    let previous: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; version: number; value: ReturnType<typeof derive> } | undefined;
    function derive(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
        const resourceIndex = buildCanvasResourceIndex(nodes, connections);
        const configInputsById = new Map<string, NodeGenerationInput[]>();
        const mentionReferencesByNodeId = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => {
            if (node.type === CanvasNodeType.Config) configInputsById.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections, resourceIndex));
            mentionReferencesByNodeId.set(node.id, buildNodeMentionReferences(node, nodes, connections, resourceIndex));
        });
        return { resourceNodes: nodes, configInputsById, mentionReferencesByNodeId };
    }
    return (nodes: CanvasNodeData[], connections: CanvasConnection[], version = 0) => {
        if (
            previous &&
            previous.version === version &&
            previous.nodes.length === nodes.length &&
            previous.connections.length === connections.length &&
            nodes.every((node, i) => {
                const old = previous!.nodes[i];
                // Plugin resource callbacks receive the whole node and may read geometry.
                return (
                    node.id === old.id && node.type === old.type && node.title === old.title && node.metadata === old.metadata && (isBuiltinNodeType(node.type) || (node.position === old.position && node.width === old.width && node.height === old.height))
                );
            }) &&
            connections.every((edge, i) => {
                const old = previous!.connections[i];
                return edge.id === old.id && edge.fromNodeId === old.fromNodeId && edge.toNodeId === old.toNodeId;
            })
        )
            return previous.value;
        const value = derive(nodes, connections);
        previous = { nodes, connections, version, value };
        return value;
    };
}
