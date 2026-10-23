import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import test from "node:test";

import { buildCanvasToolRequest } from "./operations.js";
import { parseToolInput } from "./tools.js";
import { CanvasSession } from "./session.js";
import type { ToolName } from "./schemas.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

type Operation = { type: string; id?: string; nodeType?: string; fromNodeId?: string; toNodeId?: string; nodeId?: string; mode?: string; prompt?: string; ids?: string[]; position?: { x: number; y: number }; metadata?: Record<string, unknown> };

const references = [node("prompt-existing", "text", { content: "一只站在窗边的猫" }), node("image-existing", "image", { content: "https://example.test/cat.png" })];
const state: CanvasSnapshot = { projectId: "canvas", nodes: references };
const input = { prompt: " \n@[node:prompt-existing]\t@[node:image-existing]\n", referenceNodeIds: references.map((item) => item.id) };

for (const [name, mode] of [
    ["canvas_create_generation_flow", "audio"],
    ["canvas_generate_text", "text"],
    ["canvas_generate_image", "image"],
    ["canvas_generate_video", "video"],
    ["canvas_generate_audio", "audio"],
] as const) {
    test(`${name} 直接复用现有提示词和媒体节点`, () => {
        const ops = operations(name, { ...input, mode, autoRun: true, x: 100, y: 200 }, state);
        const config = configNode(ops);
        const prompt = "@[node:prompt-existing]\n@[node:image-existing]";
        assert.equal(ops.filter((op) => op.type === "add_node").length, 1);
        assert.equal(config.metadata?.generationMode, mode);
        assert.equal(config.metadata?.composerContent, prompt);
        assert.equal(config.metadata?.prompt, prompt);
        assert.deepEqual(config.position, { x: 520, y: 200 });
        assert.deepEqual(ops.filter((op) => op.type === "connect_nodes"), references.map((item) => ({ type: "connect_nodes", fromNodeId: item.id, toNodeId: config.id })));
        assert.deepEqual(ops.find((op) => op.type === "select_nodes"), { type: "select_nodes", ids: [config.id] });
        assert.deepEqual(ops.find((op) => op.type === "run_generation"), { type: "run_generation", nodeId: config.id, mode, prompt });
    });
}

test("创建生成流程只复用节点且不自动运行", () => {
    const ops = operations("canvas_create_generation_flow", input, state);
    assert.equal(ops.filter((op) => op.type === "add_node").length, 1);
    assert.equal(ops.some((op) => op.type === "run_generation"), false);
});

test("复用仍按 referenceNodeIds 顺序保留全部输入，重复 mention 不创建文本节点", () => {
    const ops = operations("canvas_generate_image", { prompt: "@[node:image-existing]@[node:image-existing]", referenceNodeIds: input.referenceNodeIds }, state);
    assert.equal(ops.filter((op) => op.type === "add_node").length, 1);
    assert.equal(configNode(ops).metadata?.prompt, "@[node:prompt-existing]\n@[node:image-existing]");
});

for (const resource of [
    node("text-with-prompt", "text", { prompt: "现有文本提示词" }),
    node("image_with:custom.id", "image", { content: "/assets/image.png" }),
    node("video", "video", { content: "blob:video" }),
    node("audio", "audio", { content: "blob:audio" }),
]) {
    test(`复用前端协议支持的 ${resource.type} 节点 ${resource.id}`, () => {
        const ops = operations("canvas_generate_image", { prompt: `@[node:${resource.id}]`, referenceNodeIds: [resource.id] }, { nodes: [resource] });
        assert.equal(ops.filter((op) => op.type === "add_node").length, 1);
        assert.equal(configNode(ops).metadata?.prompt, `@[node:${resource.id}]`);
    });
}

for (const [label, members, reusable] of [
    ["包含正文和图片", [node("text", "text", { groupId: "group", content: "组内提示词正文" }), node("image", "image", { groupId: "group", content: "image.png" })], true],
    ["嵌套分组", [node("nested", "group", { groupId: "group" }), node("text", "text", { groupId: "nested", content: "嵌套正文" })], true],
    ["空分组", [], false],
    ["只有配置和空资源", [node("config", "config", { groupId: "group", prompt: "不是引用资源" }), node("image", "image", { groupId: "group" })], false],
    ["无有效资源的循环分组", [node("nested", "group", { groupId: "group" })], false],
    ["循环分组中包含正文", [node("nested", "group", { groupId: "group" }), node("text", "text", { groupId: "nested", content: "循环中的正文" })], true],
] satisfies Array<[string, CanvasNode[], boolean]>) {
    test(`${label}按当前组成员资源决定是否复用`, () => {
        const group = node("group", "group", { groupId: "nested" });
        const prompt = "@[node:group]";
        const ops = operations("canvas_generate_image", { prompt, referenceNodeIds: [group.id] }, { nodes: [group, ...members] });
        if (!reusable) return assertPromptNode(ops, prompt, [group.id]);
        assert.equal(ops.filter((op) => op.type === "add_node").length, 1);
        assert.equal(configNode(ops).metadata?.prompt, prompt);
        assert.deepEqual(ops.find((op) => op.type === "connect_nodes"), { type: "connect_nodes", fromNodeId: group.id, toNodeId: configNode(ops).id });
    });
}

for (const [label, data, snapshot] of [
    ["混合正文", { ...input, prompt: "画成油画 @[node:prompt-existing]" }, state],
    ["空提示词", { ...input, prompt: " \n\t" }, state],
    ["未提供引用列表", { prompt: input.prompt }, state],
    ["mention 未列在引用列表", { ...input, referenceNodeIds: ["image-existing"] }, state],
    ["mention 缺少结束符", { ...input, prompt: "@[node:prompt-existing] @[node:image-existing" }, state],
    ["空节点ID", { ...input, prompt: "@[node:]" }, state],
    ["mention 节点已删除", input, { nodes: [references[1]] }],
    ["附加引用节点已删除", { prompt: "@[node:prompt-existing]", referenceNodeIds: ["prompt-existing", "deleted"] }, state],
    ["附加引用ID为空", { prompt: "@[node:prompt-existing]", referenceNodeIds: ["prompt-existing", ""] }, { nodes: [...references, node("", "text", { content: "正文" })] }],
    ["附加引用ID不能构成完整token", { prompt: "@[node:prompt-existing]", referenceNodeIds: ["prompt-existing", "invalid]id"] }, { nodes: [...references, node("invalid]id", "text", { content: "正文" })] }],
    ["没有画布快照", input, null],
    ["没有节点快照", input, {}],
] satisfies Array<[string, Record<string, unknown>, CanvasSnapshot | null]>) {
    test(`${label} 保留原提示词文本节点`, () => {
        assertPromptNode(operations("canvas_generate_image", data, snapshot), String(data.prompt), data.referenceNodeIds as string[] | undefined);
    });
}

for (const resource of [
    node("empty", "text"),
    node("blank", "text", { content: "  \n", prompt: "后备提示词不覆盖已有空白content" }),
    node("invalid", "text", { content: 123 }),
    node("empty-image", "image", { storageKey: "image:pending" }),
    node("empty-video", "video"),
    node("empty-audio", "audio"),
    node("config", "config", { prompt: "配置不是输入资源", content: "配置内容" }),
]) {
    test(`引用 ${resource.id} 缺少可用资源时保留原提示词文本节点`, () => {
        const prompt = `@[node:${resource.id}]`;
        const ops = operations("canvas_generate_image", { prompt, referenceNodeIds: [resource.id] }, { nodes: [resource] });
        assertPromptNode(ops, prompt, [resource.id]);
    });
}

test("复用和普通文本路径都保留本地生成参数且不修改快照", () => {
    const before = structuredClone(state);
    const parameters = { model: "image-model", size: "1536x1024", quality: "high", imageQuality: "medium", outputFormat: "webp", background: "transparent", count: 2, seconds: "8", vquality: "1080p", generateAudio: "false", watermark: "false", audioVoice: "coral", audioFormat: "wav", audioSpeed: "1.25", audioInstructions: "自然朗读" };
    const expected = { generationMode: "image", status: "idle", ...parameters, imageOutputFormat: parameters.outputFormat };
    delete (expected as Partial<typeof parameters>).outputFormat;
    for (const prompt of [input.prompt, "带正文的提示词"]) {
        const metadata = configNode(operations("canvas_generate_image", { ...input, ...parameters, prompt }, state)).metadata;
        const { composerContent: _composerContent, prompt: _prompt, ...actual } = metadata || {};
        assert.deepEqual(actual, expected);
    }
    assert.deepEqual(state, before);
});

test("原图片流程和配置节点入口仍按原方式创建", () => {
    assertPromptNode(operations("canvas_create_image_prompt_flow", { prompt: "原提示词", autoRun: true }, state), "原提示词");
    const ops = operations("canvas_create_config_node", { ...input, autoRun: true }, state);
    assert.equal(ops.length, 2);
    assert.equal(configNode(ops).metadata?.prompt, input.prompt);
    assert.equal(ops[1].prompt, input.prompt);
});

test("复用只读取 turn 绑定网页快照，不采用其他活动网页的同名引用", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.emit("close");
        second.emit("close");
    });
    session.updateState(state, "first");
    session.updateState({ projectId: "other-canvas", nodes: [] }, "second");
    session.bindClient("first");
    session.activateClient("second");

    const firstResult = session.callTool("canvas_generate_image", input);
    const firstCall = first.call();
    session.resolveResult("first", { requestId: firstCall?.requestId, result: { ok: true } });
    await firstResult;
    assert.equal(second.call(), undefined);
    assert.equal((firstCall?.input.ops as Operation[]).filter((op) => op.type === "add_node").length, 1);

    session.releaseClient("first");
    const secondResult = session.callTool("canvas_generate_image", input);
    const secondCall = second.call();
    session.resolveResult("second", { requestId: secondCall?.requestId, result: { ok: true } });
    await secondResult;
    assertPromptNode(secondCall?.input.ops as Operation[], input.prompt, input.referenceNodeIds);
});

function operations(name: ToolName, data: Record<string, unknown>, snapshot: CanvasSnapshot | null) {
    const request = buildCanvasToolRequest(name, parseToolInput(name, data), snapshot);
    assert.equal(request.name, "canvas_apply_ops");
    return request.input.ops as Operation[];
}

function configNode(ops: Operation[]) {
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    assert.ok(config);
    return config;
}

function assertPromptNode(ops: Operation[], prompt: string, referenceNodeIds: string[] = []) {
    const text = ops.find((op) => op.type === "add_node" && op.nodeType === "text");
    const config = configNode(ops);
    assert.ok(text);
    assert.equal(text.metadata?.content, prompt);
    assert.equal(ops.filter((op) => op.type === "add_node").length, 2);
    const tokens = [text.id, ...referenceNodeIds].map((id) => `@[node:${id}]`).join("\n");
    assert.equal(config.metadata?.prompt, tokens);
    assert.equal(config.metadata?.composerContent, tokens);
    assert.deepEqual(ops.filter((op) => op.type === "connect_nodes").map((op) => op.fromNodeId), [text.id, ...referenceNodeIds]);
    assert.equal(ops.find((op) => op.type === "run_generation")?.prompt, tokens);
}

function node(id: string, type: CanvasNode["type"] | "group", metadata: CanvasNode["metadata"] = {}): CanvasNode {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, metadata } as CanvasNode;
}

function connect(session: CanvasSession, clientId: string) {
    const response = new FakeSseResponse();
    session.openEvents(new URL(`http://127.0.0.1/events?clientId=${clientId}`), response as unknown as ServerResponse);
    return response;
}

class FakeSseResponse extends EventEmitter {
    private chunks: string[] = [];
    writeHead() { return this; }
    write(chunk: string) { this.chunks.push(chunk); return true; }
    call() {
        const chunk = this.chunks.find((item) => item.startsWith("event: tool_call\n"));
        const data = chunk?.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        return data ? JSON.parse(data) as { requestId: string; input: { ops: Operation[] } } : undefined;
    }
}
