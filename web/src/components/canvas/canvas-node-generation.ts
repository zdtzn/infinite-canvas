import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { buildCanvasResourceIndex, getGenerationResourceNodes, getGroupResourceNodes, readCanvasNodeResource, type CanvasResourceIndex } from "@/lib/canvas/canvas-resource-references";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationResourceInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export type NodeGenerationInput = NodeGenerationResourceInput | {
    nodeId: string;
    type: "group";
    title: string;
    children: NodeGenerationResourceInput[];
    text?: undefined;
    image?: undefined;
    video?: undefined;
    audio?: undefined;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    const resources = flattenGenerationInputs(inputs);
    const upstreamText = resources
        .filter((input) => input.text)
        .map((input, index) => `【文本${index + 1}】\n${input.text}`)
        .join("\n\n");
    const referenceImages = resources.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = resources.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = resources.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: resources.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map<string, NodeGenerationInput>([...flattenGenerationInputs(inputs), ...inputs].map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationResourceInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            nextPrompt += flattenGenerationInputs([input]).map((resource) => {
                let label = labelByNodeId.get(resource.nodeId);
                if (!label) {
                    label = generationLabel(resource.type, counts[resource.type]++);
                    labelByNodeId.set(resource.nodeId, label);
                    if (resource.type === "text") textBlocks.push(`【${label}】\n${resource.text || ""}`);
                    else selectedInputs.push(resource);
                }
                return resource.type === "text" ? `【${label}】` : label;
            }).join("、");
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    if (!hasToken) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index = buildCanvasResourceIndex(nodes, connections)): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections, index).flatMap((node): NodeGenerationInput[] => {
        if (node.type !== CanvasNodeType.Group) return readNodeGenerationResource(node);
        const children = getGroupResourceNodes(node.id, nodes, index).filter((member) => member.id !== nodeId).flatMap(readNodeGenerationResource);
        return children.length ? [{ nodeId: node.id, type: "group", title: node.title, children }] : [];
    });
}

export function flattenGenerationInputs(inputs: NodeGenerationInput[]): NodeGenerationResourceInput[] {
    const seen = new Set<string>();
    return inputs.flatMap((input) => input.type === "group" ? input.children : [input]).filter((input) => {
        if (seen.has(input.nodeId)) return false;
        seen.add(input.nodeId);
        return true;
    });
}

function readNodeGenerationResource(node: CanvasNodeData): NodeGenerationResourceInput[] {
    const resource = readCanvasNodeResource(node);
    if (!resource) return [];
    const base = { nodeId: node.id, title: node.title };
    if (resource.kind === "text") return [{ ...base, type: "text", text: resource.text }];
    if (resource.kind === "image") return [{ ...base, type: "image", image: readReferenceImage(node, resource.url!) }];
    if (resource.kind === "video") return [{ ...base, type: "video", video: readReferenceVideo(node, resource.url!) }];
    return [{ ...base, type: "audio", audio: readReferenceAudio(node, resource.url!) }];
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function generationLabel(type: NodeGenerationResourceInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData, url: string): ReferenceImage {
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata?.mimeType || "image/png",
        dataUrl: url,
        storageKey: node.metadata?.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData, url: string): ReferenceVideo {
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata?.mimeType || "video/mp4",
        url,
        storageKey: node.metadata?.storageKey,
        bytes: node.metadata?.bytes,
        width: node.metadata?.naturalWidth,
        height: node.metadata?.naturalHeight,
        durationMs: node.metadata?.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData, url: string): ReferenceAudio {
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata?.mimeType || "audio/mpeg",
        url,
        storageKey: node.metadata?.storageKey,
        durationMs: node.metadata?.durationMs,
    };
}
