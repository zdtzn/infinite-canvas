import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export type CanvasResourceIndex = {
    nodesById: Map<string, CanvasNodeData>;
    contextByNodeId: Map<string, CanvasNodeData[]>;
    configTargetByNodeId: Map<string, string>;
};

export function buildCanvasResourceIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasResourceIndex {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const contextByNodeId = new Map<string, CanvasNodeData[]>();
    const configTargetByNodeId = new Map<string, string>();
    connections.forEach((connection) => {
        const source = nodesById.get(connection.fromNodeId);
        const target = nodesById.get(connection.toNodeId);
        if (!source || !target) return;
        const context = contextByNodeId.get(target.id) || [];
        context.push(source);
        contextByNodeId.set(target.id, context);
        if (target.type === CanvasNodeType.Config && !configTargetByNodeId.has(source.id)) configTargetByNodeId.set(source.id, target.id);
    });
    return { nodesById, contextByNodeId, configTargetByNodeId };
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], index?: CanvasResourceIndex) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections, index), true);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index?: CanvasResourceIndex) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections, index);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections, index);
    if (ownInputs.length) return ownInputs;
    const node = index?.nodesById.get(nodeId) || nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index?: CanvasResourceIndex) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections, index);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections, index);
    if (ownInputs.length) return ownInputs;
    return [];
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index?: CanvasResourceIndex) {
    if (index) return (index.contextByNodeId.get(nodeId) || []).filter(isResourceNode);
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isResourceNode(node)));
}

function getConnectedConfigResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index?: CanvasResourceIndex) {
    const configTargetId = index?.configTargetByNodeId.get(nodeId);
    if (configTargetId) return getContextResourceNodes(configTargetId, nodes, connections, index).filter((node) => node.id !== nodeId);
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextResourceNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.content,
                text: resourceText(node),
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // 插件节点通过 definition.resource 声明可作为输入
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
