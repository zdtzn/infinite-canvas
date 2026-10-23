import { afterAll, describe, expect, test } from "bun:test";

import { buildNodeGenerationContext, buildNodeGenerationInputs, flattenGenerationInputs } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { buildCanvasResourceIndex, buildNodeMentionReferences, buildNodeResourceReferences, getGenerationResourceNodes, getGroupResourceNodes, getNodeReferenceTargetId, isCanvasReferenceNode } from "./canvas-resource-references";
import { registerNodeDefinitions, unregisterPluginNodes } from "./node-registry";

const node = (id: string, type: CanvasNodeData["type"], metadata: CanvasNodeMetadata = {}): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
const edge = (fromNodeId: string, toNodeId = "target"): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });
const group = node("group", CanvasNodeType.Group);
const otherGroup = node("other-group", CanvasNodeType.Group);
const image = node("image", CanvasNodeType.Image, { groupId: group.id, content: "original.png", thumbnailUrl: "thumb.webp", storageKey: "image:original" });
const video = node("video", CanvasNodeType.Video, { groupId: group.id, content: "clip.mp4", durationMs: 1000 });
const audio = node("audio", CanvasNodeType.Audio, { groupId: group.id, content: "clip.mp3", durationMs: 2000 });
const text = node("text", CanvasNodeType.Text, { groupId: group.id, content: "参考文字" });
const target = node("target", CanvasNodeType.Image);
const resources = [group, image, video, audio, text, target];

describe("group resource references", () => {
    test("expands valid mixed media in node order and keeps lightweight preview provenance", () => {
        const connections = [edge(group.id)];
        const refs = buildNodeResourceReferences(target, resources, connections);
        expect(refs.map((ref) => [ref.nodeId, ref.label])).toEqual([[image.id, "图片1"], [video.id, "视频1"], [audio.id, "音频1"], [text.id, "文本1"]]);
        expect(refs[0]).toMatchObject({ sourceNodeId: group.id, sourceTitle: group.title, connectionTargetId: target.id, previewUrl: "original.png", thumbnailUrl: "thumb.webp" });
        const result = buildNodeGenerationContext(target.id, resources, connections, "生成");
        expect(result.referenceImages.map((item) => item.id)).toEqual([image.id]);
        expect(result.referenceVideos[0].durationMs).toBe(1000);
        expect(result.referenceAudios[0].durationMs).toBe(2000);
        expect(result.prompt).toBe("生成\n\n【文本1】\n参考文字");
    });

    test("deduplicates direct, duplicate and overlapping nested group connections in first encounter order", () => {
        const nested = { ...group, metadata: { groupId: otherGroup.id } };
        const nodes = [otherGroup, nested, image, video, audio, text, target];
        const connections = [edge(video.id), edge(group.id), edge(group.id), edge(otherGroup.id), edge(image.id)];
        const refs = buildNodeResourceReferences(target, nodes, connections);
        expect(refs.map((ref) => ref.nodeId)).toEqual([video.id, image.id, audio.id, text.id]);
        expect(refs[0].sourceNodeId).toBe(video.id);
        expect(refs[1].sourceNodeId).toBe(group.id);
        const inputs = buildNodeGenerationInputs(target.id, nodes, connections);
        expect(flattenGenerationInputs(inputs).map((input) => input.nodeId)).toEqual(refs.map((ref) => ref.nodeId));
        expect(buildNodeGenerationContext(target.id, nodes, connections, "生成").videoCount).toBe(1);
    });

    test("excludes a target inside its source group and rejects empty/unfinished groups", () => {
        const completedTarget = { ...target, metadata: { groupId: group.id, content: "target.png" } };
        const unfinished = node("unfinished", CanvasNodeType.Image, { groupId: otherGroup.id });
        const whitespace = node("whitespace", CanvasNodeType.Text, { groupId: otherGroup.id, content: "  " });
        const nodes = [group, otherGroup, completedTarget, image, unfinished, whitespace];
        expect(buildNodeResourceReferences(completedTarget, nodes, [edge(group.id), edge(target.id)])?.map((ref) => ref.nodeId)).toEqual([image.id]);
        expect(isCanvasReferenceNode(otherGroup, nodes)).toBe(false);
        expect(getGenerationResourceNodes(target.id, nodes, [edge(otherGroup.id)])).toEqual([]);
        expect(buildNodeGenerationContext(target.id, nodes, [edge(group.id)], "生成").referenceImages.map((item) => item.id)).toEqual([image.id]);
    });

    test("retains config input priority and the actual edge target used for removal", () => {
        const config = node("config", CanvasNodeType.Config);
        const own = node("own", CanvasNodeType.Image, { content: "own.png" });
        const nodes = [...resources, config, own];
        const connections = [edge(target.id, config.id), edge(group.id, config.id), edge(own.id)];
        const refs = buildNodeResourceReferences(target, nodes, connections);
        expect(refs.map((ref) => ref.nodeId)).toEqual([image.id, video.id, audio.id, text.id]);
        expect(refs.every((ref) => ref.connectionTargetId === config.id)).toBe(true);
        expect(getNodeReferenceTargetId(target.id, nodes, connections)).toBe(config.id);
        expect(getNodeReferenceTargetId(own.id, nodes, connections)).toBe(own.id);
        expect(buildNodeResourceReferences(target, nodes, [edge(target.id, config.id), edge(own.id)]).map((ref) => ref.nodeId)).toEqual([own.id]);
    });

    test("an isolated resource is suggested for mentions but never presented as an incoming edge", () => {
        expect(buildNodeMentionReferences(image, resources, [])[0].nodeId).toBe(image.id);
        expect(buildNodeResourceReferences(image, resources, [])).toEqual([]);
    });

    test("image editing reserves image one for the current image and numbers incoming images in request order", () => {
        const completed = { ...target, metadata: { content: "current.png", groupId: group.id } };
        const second = node("second", CanvasNodeType.Image, { groupId: group.id, content: "second.png" });
        const nodes = [group, completed, image, second];
        const connections = [edge(image.id), edge(group.id)];
        const refs = buildNodeResourceReferences(completed, nodes, connections);
        expect(refs.map((ref) => [ref.nodeId, ref.label])).toEqual([[image.id, "图片2"], [second.id, "图片3"]]);
        const mentions = buildNodeMentionReferences(completed, nodes, connections);
        expect(mentions.map((ref) => [ref.nodeId, ref.label])).toEqual([[completed.id, "图片1"], [image.id, "图片2"], [second.id, "图片3"]]);
        const context = buildNodeGenerationContext(completed.id, nodes, connections, "修改");
        // The canvas image-edit path prepends the current image, then the connected snapshot.
        expect([completed.id, ...context.referenceImages.map((ref) => ref.id)]).toEqual(mentions.map((ref) => ref.nodeId));
        expect(buildNodeMentionReferences(completed, nodes, []).map((ref) => ref.label)).toEqual(["图片1"]);
    });

    test("reuses indexed group expansion and terminates malformed nesting cycles", () => {
        const a = { ...group, metadata: { groupId: otherGroup.id } };
        const b = { ...otherGroup, metadata: { groupId: group.id } };
        const nodes = [a, b, image, video, target];
        const index = buildCanvasResourceIndex(nodes, []);
        const first = getGroupResourceNodes(group.id, nodes, index);
        expect(first.map((item) => item.id)).toEqual([image.id, video.id]);
        expect(getGroupResourceNodes(group.id, nodes, index)).toBe(first);
        expect(getGroupResourceNodes(otherGroup.id, nodes, index).map((item) => item.id)).toEqual([image.id, video.id]);
        expect(getGroupResourceNodes("missing", nodes, index)).toEqual([]);
    });
});

describe("composer group references", () => {
    const config = node("target", CanvasNodeType.Config, { composerContent: "使用参考" });
    const nodes = resources.map((item) => item.id === target.id ? config : item);

    test("expands group tokens with Seedance labels and reuses repeated member labels", () => {
        const result = buildNodeGenerationContext(config.id, nodes, [edge(group.id), edge(image.id)], "按 @[node:group]，再看 @[node:image] 与 @[node:group]");
        expect(result.prompt).toBe("按 图片1、视频1、音频1、【文本1】，再看 图片1 与 图片1、视频1、音频1、【文本1】\n\n【文本1】\n参考文字");
        expect([result.imageCount, result.videoCount, result.audioCount, result.textCount]).toEqual([1, 1, 1, 1]);
    });

    test("numbers actual selected media in prompt order across groups and direct members", () => {
        const second = node("second", CanvasNodeType.Image, { content: "second.png" });
        const result = buildNodeGenerationContext(config.id, [...nodes, second], [edge(group.id), edge(second.id)], "@[node:second] 配合 @[node:group]");
        expect(result.referenceImages.map((item) => item.id)).toEqual([second.id, image.id]);
        expect(result.prompt).toStartWith("图片1 配合 图片2、视频1、音频1、【文本1】");
    });

    test("only includes selected tokens and ignores disconnected or stale tokens", () => {
        expect(buildNodeGenerationContext(config.id, nodes, [edge(group.id)], "只有文字").imageCount).toBe(0);
        const selected = buildNodeGenerationContext(config.id, nodes, [edge(group.id)], "@[node:video] @[node:missing]");
        expect(selected.videoCount).toBe(1);
        expect(selected.imageCount).toBe(0);
        expect(selected.prompt).toBe("视频1 ");
    });

    test("freezes the current members and content in a submitted context", () => {
        const before = buildNodeGenerationContext(config.id, nodes, [edge(group.id)], "@[node:group]");
        const changed = nodes.map((item) => item.id === image.id ? { ...item, metadata: { ...item.metadata, content: "changed.png", groupId: undefined } } : item);
        const after = buildNodeGenerationContext(config.id, changed, [edge(group.id)], "@[node:group]");
        expect(before.referenceImages[0].dataUrl).toBe("original.png");
        expect(after.imageCount).toBe(0);
    });
});

describe("plugin resource contract", () => {
    const pluginId = "group-resource-test";
    const pluginNodes = ["image", "video", "audio", "text"].map((kind) => node(`${kind}-plugin`, `${pluginId}:${kind}`, { groupId: group.id, prompt: "do not replace declared content" }));
    registerNodeDefinitions(pluginNodes.map((item) => ({
        type: item.type,
        title: item.title,
        icon: null,
        defaultSize: { width: 100, height: 100 },
        resource: () => item.type.endsWith("text") ? { kind: "text", text: "插件正文" } : { kind: item.type.split(":")[1] as "image" | "video" | "audio", url: `${item.id}.asset` },
    })), pluginId);
    afterAll(() => unregisterPluginNodes(pluginId));

    test("previews and submits the same declared media/text rather than dropping plugin resources", () => {
        const nodes = [group, ...pluginNodes, target];
        const refs = buildNodeResourceReferences(target, nodes, [edge(group.id)]);
        const context = buildNodeGenerationContext(target.id, nodes, [edge(group.id)], "生成");
        expect(refs.slice(0, 3).map((item) => item.previewUrl)).toEqual(["image-plugin.asset", "video-plugin.asset", "audio-plugin.asset"]);
        expect(context.referenceImages[0].dataUrl).toBe(refs[0].previewUrl!);
        expect(context.referenceVideos[0].url).toBe(refs[1].previewUrl!);
        expect(context.referenceAudios[0].url).toBe(refs[2].previewUrl!);
        expect(context.prompt).toEndWith("【文本1】\n插件正文");
    });
});
