import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import type { CanvasNodeResource } from "@/types/canvas-plugin";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    text?: string;
    active: boolean;
    sourceNodeId?: string;
    sourceTitle?: string;
    connectionTargetId?: string;
};

export type CanvasResourceIndex = {
    nodesById: Map<string, CanvasNodeData>;
    contextByNodeId: Map<string, CanvasNodeData[]>;
    configTargetByNodeId: Map<string, string>;
    groupMembersById: Map<string, CanvasNodeData[]>;
    groupResourcesById: Map<string, CanvasNodeData[]>;
};

export function buildCanvasResourceIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasResourceIndex {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const contextByNodeId = new Map<string, CanvasNodeData[]>();
    const configTargetByNodeId = new Map<string, string>();
    const groupMembersById = new Map<string, CanvasNodeData[]>();
    nodes.forEach((node) => {
        if (!node.metadata?.groupId) return;
        const members = groupMembersById.get(node.metadata.groupId) || [];
        members.push(node);
        groupMembersById.set(node.metadata.groupId, members);
    });
    connections.forEach((connection) => {
        const source = nodesById.get(connection.fromNodeId);
        const target = nodesById.get(connection.toNodeId);
        if (!source || !target) return;
        const context = contextByNodeId.get(target.id) || [];
        context.push(source);
        contextByNodeId.set(target.id, context);
        if (target.type === CanvasNodeType.Config && !configTargetByNodeId.has(source.id)) configTargetByNodeId.set(source.id, target.id);
    });
    return { nodesById, contextByNodeId, configTargetByNodeId, groupMembersById, groupResourcesById: new Map() };
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], index?: CanvasResourceIndex) {
    const references = buildNodeResourceReferences(node, nodes, connections, index);
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return [...labelResourceEntries([{ node }]), ...references];
    return references.length ? references : labelResourceEntries(readCanvasNodeResource(node) ? [{ node }] : []);
}

// Unlike mention suggestions, the reference bar must never fall back to the node itself.
export function buildNodeResourceReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], index = buildCanvasResourceIndex(nodes, connections)) {
    const seen = new Set<string>();
    const entries = getGenerationResourceSources(node.id, index).flatMap(({ source, connectionTargetId }) => {
        const resources = source.type === CanvasNodeType.Group ? getGroupResourceNodes(source.id, nodes, index) : [source];
        return resources.flatMap((resource) => {
            if (resource.id === node.id || seen.has(resource.id)) return [];
            seen.add(resource.id);
            return [{ node: resource, source, connectionTargetId }];
        });
    });
    return labelResourceEntries(entries, node.type === CanvasNodeType.Image && node.metadata?.content ? 1 : 0);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index = buildCanvasResourceIndex(nodes, connections)) {
    const node = index.nodesById.get(nodeId);
    if (!node) return [];
    return buildNodeMentionReferences(node, nodes, connections, index).map((reference) => index.nodesById.get(reference.nodeId)!);
}

// Keep group entry points for the composer; generation expands their current members once at submission.
export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index = buildCanvasResourceIndex(nodes, connections)) {
    return getGenerationResourceSources(nodeId, index).map(({ source }) => source);
}

export function getNodeReferenceTargetId(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index = buildCanvasResourceIndex(nodes, connections)) {
    return index.configTargetByNodeId.get(nodeId) || nodeId;
}

function getGenerationResourceSources(nodeId: string, index: CanvasResourceIndex) {
    const configTargetId = index.configTargetByNodeId.get(nodeId);
    const configInputs = configTargetId ? getContextResourceSources(configTargetId, nodeId, index) : [];
    return configInputs.length ? configInputs : getContextResourceSources(nodeId, nodeId, index);
}

function getContextResourceSources(connectionTargetId: string, excludedNodeId: string, index: CanvasResourceIndex) {
    const seen = new Set<string>();
    return (index.contextByNodeId.get(connectionTargetId) || []).flatMap((source) => {
        if (source.id === excludedNodeId || seen.has(source.id)) return [];
        seen.add(source.id);
        const valid = source.type === CanvasNodeType.Group
            ? getGroupResourceNodes(source.id, [], index).some((node) => node.id !== excludedNodeId)
            : Boolean(readCanvasNodeResource(source));
        return valid ? [{ source, connectionTargetId }] : [];
    });
}

export function isCanvasReferenceNode(node: CanvasNodeData, nodes: CanvasNodeData[], index?: CanvasResourceIndex) {
    return Boolean(readCanvasNodeResource(node)) || (node.type === CanvasNodeType.Group && getGroupResourceNodes(node.id, nodes, index).length > 0);
}

export function getGroupResourceNodes(groupId: string, nodes: CanvasNodeData[], index = buildCanvasResourceIndex(nodes, [])) {
    if (index.nodesById.get(groupId)?.type !== CanvasNodeType.Group) return [];
    const cached = index.groupResourcesById.get(groupId);
    if (cached) return cached;
    const seen = new Set<string>([groupId]);
    const resources: CanvasNodeData[] = [];
    const visit = (id: string) => {
        for (const member of index.groupMembersById.get(id) || []) {
            if (seen.has(member.id)) continue;
            seen.add(member.id);
            if (member.type === CanvasNodeType.Group) visit(member.id);
            else if (readCanvasNodeResource(member)) resources.push(member);
        }
    };
    visit(groupId);
    index.groupResourcesById.set(groupId, resources);
    return resources;
}

function labelResourceEntries(entries: Array<{ node: CanvasNodeData; source?: CanvasNodeData; connectionTargetId?: string }>, imageOffset = 0): CanvasResourceReference[] {
    const counts: Record<CanvasResourceKind, number> = { image: imageOffset, video: 0, audio: 0, text: 0 };
    return entries.flatMap(({ node, source, connectionTargetId }) => {
        const resource = readCanvasNodeResource(node);
        if (!resource) return [];
        const label = labelForKind(resource.kind, counts[resource.kind]++);
        return [{
            id: node.id,
            nodeId: node.id,
            kind: resource.kind,
            label,
            title: node.title || label,
            previewUrl: resource.url,
            thumbnailUrl: node.metadata?.thumbnailUrl,
            text: resource.text,
            active: true,
            sourceNodeId: source?.id,
            sourceTitle: source?.title,
            connectionTargetId,
        }];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

// Reference eligibility, previews and generation must read the same resource contract.
export function readCanvasNodeResource(node: CanvasNodeData): CanvasNodeResource | null {
    if ((node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.content) {
        return { kind: node.type, url: node.metadata.content };
    }
    if (node.type === CanvasNodeType.Text) {
        const text = node.metadata?.content || node.metadata?.prompt;
        if (text?.trim()) return { kind: "text", text };
    }
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if (!resource || (resource.kind === "text" ? !resource.text?.trim() : !resource.url)) return null;
    return resource;
}
