import assert from "node:assert/strict";
import test from "node:test";

import { toolInputSchemas } from "./schemas.js";
import { buildCanvasToolRequest } from "./operations.js";

test("视频工具保留首尾帧和全能参考模式，以及已有生成参数", () => {
    for (const mode of ["frames", "reference"]) {
        const workbench = toolInputSchemas.workbench_video_generate.parse({ prompt: "fixture", mode, resolution: "1080", generateAudio: false, watermark: true });
        assert.equal(workbench.mode, mode);
        assert.equal(workbench.generateAudio, false);
        assert.equal(workbench.watermark, true);
        for (const name of ["canvas_create_config_node", "canvas_create_generation_flow", "canvas_generate_video"] as const) {
            const parsed = toolInputSchemas[name].parse({ prompt: "fixture", videoMode: mode, quality: "medium", imageQuality: "high", outputFormat: "webp", vquality: "1080p", generateAudio: "false", watermark: "true" });
            assert.equal(parsed.videoMode, mode);
            assert.equal(parsed.quality, "medium");
            assert.equal(parsed.imageQuality, "high");
            assert.equal(parsed.outputFormat, "webp");
            assert.equal(parsed.vquality, "1080p");
            const ops = buildCanvasToolRequest(name, parsed, null).input.ops as Array<{ nodeType?: string; metadata?: Record<string, unknown> }>;
            assert.equal(ops.find((op) => op.nodeType === "config")?.metadata?.videoMode, mode);
        }
    }
});

test("视频模式可省略，画布保留空模式，不接受未知模式", () => {
    assert.equal(toolInputSchemas.workbench_video_generate.parse({ prompt: "fixture" }).mode, undefined);
    assert.equal(toolInputSchemas.canvas_generate_video.parse({ prompt: "fixture" }).videoMode, undefined);
    assert.equal(toolInputSchemas.canvas_generate_video.parse({ prompt: "fixture", videoMode: "" }).videoMode, "");
    for (const value of ["invalid", "first-last-frame", "all-reference", null, 1]) {
        assert.equal(toolInputSchemas.workbench_video_generate.safeParse({ prompt: "fixture", mode: value }).success, false);
        assert.equal(toolInputSchemas.canvas_generate_video.safeParse({ prompt: "fixture", videoMode: value }).success, false);
    }
});
