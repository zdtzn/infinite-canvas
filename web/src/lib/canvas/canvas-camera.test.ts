import { describe, expect, test } from "bun:test";
import { applyCameraPrompt, CAMERA_PROMPT_START, CAMERA_PROMPT_END, normalizeCameraSettings } from "./canvas-camera";
import type { CanvasCameraSettings, CanvasNodeMetadata } from "@/types/canvas";

const settings: CanvasCameraSettings = { enabled: true, cameraId: "arri_alexa_mini_lf", lensId: "cooke_s7i", focalLength: 85, aperture: 1.4 };

describe("canvas camera", () => {
    test("old metadata and disabled defaults preserve the exact raw prompt", () => {
        const prompt = "  雨夜人像\n保留灯光与角度  \n";
        expect(normalizeCameraSettings(undefined)).toEqual({ enabled: false });
        expect(applyCameraPrompt(prompt, undefined, "image")).toBe(prompt);
        expect(applyCameraPrompt(prompt, { ...settings, enabled: false }, "video")).toBe(prompt);
    });

    test("normalizes untrusted persisted values without coercion or mutation", () => {
        for (const value of [null, [], "camera", 1]) expect(normalizeCameraSettings(value)).toEqual({ enabled: false });
        expect(normalizeCameraSettings({ enabled: "true", cameraId: "invented", lensId: "<script>", focalLength: Infinity, aperture: "1.4" })).toEqual({ enabled: false });
        expect(normalizeCameraSettings({ enabled: true, focalLength: -35, aperture: NaN })).toEqual({ enabled: true });
        expect(normalizeCameraSettings({ enabled: true, focalLength: 999, aperture: 0 })).toEqual({ enabled: true });
        const frozen = Object.freeze({ ...settings, extra: "ignored" });
        expect(normalizeCameraSettings(frozen)).toEqual(settings);
    });

    test("enabled but empty or invalid settings add no block", () => {
        expect(applyCameraPrompt("原文", { enabled: true, cameraId: "invalid" }, "image")).toBe("原文");
    });

    test("image and video compose all four parameters idempotently", () => {
        for (const mode of ["image", "video"] as const) {
            const once = applyCameraPrompt("人像", settings, mode);
            expect(once).toContain("ARRI Alexa Mini LF");
            expect(once).toContain("Cooke S7/i");
            expect(once).toContain("85mm");
            expect(once).toContain("f/1.4");
            expect(once.split(CAMERA_PROMPT_START)).toHaveLength(2);
            expect(applyCameraPrompt(once, settings, mode)).toBe(once);
        }
    });

    test("replacement and disable remove every old camera block, preserving other guidance", () => {
        const raw = "  原文\n[角度]俯拍[/角度]\n[灯光]暖光[/灯光]  \n";
        const old = applyCameraPrompt(raw, settings, "image");
        const next = applyCameraPrompt(old, { enabled: true, focalLength: 35 }, "image");
        expect(next).toContain("35mm");
        expect(next).not.toContain("85mm");
        expect(applyCameraPrompt(next, { enabled: false }, "image")).toBe(raw);
        expect(applyCameraPrompt(`${old}\n\n${CAMERA_PROMPT_START}stale${CAMERA_PROMPT_END}`, undefined, "image")).toBe(raw);
    });

    test("empty prompts round trip and incomplete user markers remain untouched", () => {
        expect(applyCameraPrompt(applyCameraPrompt("", settings, "image"), undefined, "image")).toBe("");
        const raw = `用户示例 ${CAMERA_PROMPT_START}未闭合`;
        expect(applyCameraPrompt(raw, undefined, "image")).toBe(raw);
    });

    test("text and audio are unchanged even when passed camera markers", () => {
        const prompt = applyCameraPrompt("原文", settings, "image");
        for (const mode of ["text", "audio"] as const) expect(applyCameraPrompt(prompt, settings, mode)).toBe(prompt);
    });

    test("camera metadata survives spread duplication and JSON persistence without touching raw prompts", () => {
        const metadata: CanvasNodeMetadata = { prompt: "原始提示词", content: "旧内容", storageKey: "image:existing", camera: settings };
        const duplicate = { ...metadata, camera: normalizeCameraSettings(metadata.camera) };
        const restored: CanvasNodeMetadata = JSON.parse(JSON.stringify(duplicate));
        expect(restored).toEqual(metadata);
        restored.camera!.focalLength = 35;
        expect(metadata.camera!.focalLength).toBe(85);
        expect(metadata.prompt).toBe("原始提示词");
        expect(JSON.parse(JSON.stringify({ prompt: "旧节点" })).camera).toBeUndefined();
    });
});
