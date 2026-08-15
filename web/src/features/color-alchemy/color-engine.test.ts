import { describe, expect, test } from "bun:test";

import { analyzedColorFromRgb, applyColorSettingsToImageData, buildColorHarmonies, deriveBorrowedColorSettings, extractColorAnalysis, formatColorValue } from "./color-engine";
import { applyColorPreset, COLOR_PRESETS } from "./presets";
import { createDefaultColorSettings } from "./settings";

function imageData(values: number[]) {
    return { data: new Uint8ClampedArray(values), width: values.length / 4, height: 1, colorSpace: "srgb" } as ImageData;
}

describe("Color Alchemy engine", () => {
    test("keeps pixels unchanged with neutral settings", () => {
        const source = imageData([52, 104, 208, 255]);
        applyColorSettingsToImageData(source, 1, 1, createDefaultColorSettings());
        expect(Array.from(source.data)).toEqual([52, 104, 208, 255]);
    });

    test("increases visible luminance when exposure rises", () => {
        const source = imageData([64, 64, 64, 255]);
        const settings = { ...createDefaultColorSettings(), exposure: 50 };
        applyColorSettingsToImageData(source, 1, 1, settings);
        expect(source.data[0]).toBeGreaterThan(110);
        expect(source.data[1]).toBe(source.data[0]);
    });

    test("extracts distinct palette colors and creates harmonies", () => {
        const source = imageData([224, 38, 45, 255, 224, 38, 45, 255, 28, 160, 92, 255, 28, 160, 92, 255, 44, 88, 210, 255]);
        const analysis = extractColorAnalysis(source);
        expect(analysis.palette.colors.length).toBeGreaterThanOrEqual(3);
        expect(analysis.palette.primary.hex).toMatch(/^#[0-9A-F]{6}$/);
        expect(buildColorHarmonies(analysis.palette.primary).map((item) => item.label)).toEqual(["类似色", "互补色", "三角色", "分裂互补"]);
    });

    test("borrows color statistics without replacing image content settings", () => {
        const current = createDefaultColorSettings();
        const source = extractColorAnalysis(imageData([40, 90, 180, 255, 40, 90, 180, 255]));
        const reference = extractColorAnalysis(imageData([220, 120, 45, 255, 220, 120, 45, 255]));
        const borrowed = deriveBorrowedColorSettings(source, reference, current);
        expect(borrowed.temperature).toBeGreaterThan(current.temperature);
        expect(borrowed.splitTone.highlightSaturation).toBeGreaterThanOrEqual(0);
        expect(borrowed.exposure).toBeGreaterThanOrEqual(-100);
        expect(borrowed.exposure).toBeLessThanOrEqual(100);
    });

    test("borrows the same color target when applied repeatedly", () => {
        const source = extractColorAnalysis(imageData([40, 90, 180, 255, 40, 90, 180, 255]));
        const reference = extractColorAnalysis(imageData([220, 120, 45, 255, 220, 120, 45, 255]));
        const first = deriveBorrowedColorSettings(source, reference, createDefaultColorSettings());
        const second = deriveBorrowedColorSettings(source, reference, first);

        expect(second).toEqual(first);
    });

    test("applies preset intensity as a bounded non-destructive settings object", () => {
        const preset = COLOR_PRESETS[0];
        const half = applyColorPreset(preset, 50);
        const full = applyColorPreset(preset, 100);
        expect(half.preset).toBe(preset.id);
        expect(half.contrast).toBeCloseTo(full.contrast / 2);
        expect(full.presetIntensity).toBe(100);
    });

    test("formats extracted colors for HEX, RGB, and HSL copy actions", () => {
        const color = extractColorAnalysis(imageData([224, 38, 45, 255])).palette.primary;
        expect(formatColorValue(color, "hex")).toMatch(/^#[0-9A-F]{6}$/);
        expect(formatColorValue(color, "rgb")).toMatch(/^rgb\(/);
        expect(formatColorValue(color, "hsl")).toMatch(/^hsl\(/);
    });

    test("converts an eyedropper RGB sample into reusable color values", () => {
        const color = analyzedColorFromRgb([255, 128, 0]);
        expect(color.hex).toBe("#FF8000");
        expect(color.rgb).toEqual([255, 128, 0]);
        expect(formatColorValue(color, "hsl")).toBe("hsl(30, 100%, 50%)");
    });
});
