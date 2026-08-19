import { describe, expect, test } from "bun:test";

import { buildColorCurveLut, colorCurveIsNeutral, sampleColorCurveLut } from "./color-curve";
import { applyColorSettingsToImageData } from "./color-engine";
import { createDefaultColorSettings, normalizeColorSettings } from "./settings";

function imageData(values: number[]) {
    return { data: new Uint8ClampedArray(values), width: values.length / 4, height: 1, colorSpace: "srgb" } as ImageData;
}

describe("Color Alchemy point curves", () => {
    test("builds an identity LUT for a neutral curve", () => {
        const curve = [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
        ];
        const lut = buildColorCurveLut(curve);

        expect(colorCurveIsNeutral(curve)).toBe(true);
        expect(sampleColorCurveLut(lut, 0)).toBeCloseTo(0);
        expect(sampleColorCurveLut(lut, 0.5)).toBeCloseTo(0.5, 3);
        expect(sampleColorCurveLut(lut, 1)).toBeCloseTo(1);
    });

    test("maps pixels through the master and individual channel curves", () => {
        const source = imageData([128, 128, 128, 255]);
        const settings = createDefaultColorSettings();
        settings.curves.red = [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.75 },
            { x: 1, y: 1 },
        ];

        applyColorSettingsToImageData(source, 1, 1, settings);

        expect(source.data[0]).toBeGreaterThan(180);
        expect(source.data[1]).toBe(128);
        expect(source.data[2]).toBe(128);
    });

    test("migrates legacy shadow, midtone, and highlight values into control points", () => {
        const legacy = createDefaultColorSettings() as unknown as Record<string, unknown>;
        legacy.curves = {
            rgb: [20, -10, 15],
            red: [0, 0, 0],
            green: [0, 0, 0],
            blue: [0, 0, 0],
        };

        const normalized = normalizeColorSettings(legacy);

        expect(normalized.curves.rgb).toHaveLength(5);
        expect(normalized.curves.rgb[0]).toEqual({ x: 0, y: 0.05 });
        expect(normalized.curves.red).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 1 },
        ]);
    });

    test("sorts and bounds imported control points while restoring endpoints", () => {
        const imported = createDefaultColorSettings() as unknown as Record<string, unknown>;
        imported.curves = {
            rgb: [
                { x: 0.8, y: 1.4 },
                { x: 0.25, y: -0.2 },
            ],
        };

        const normalized = normalizeColorSettings(imported);

        expect(normalized.curves.rgb).toEqual([
            { x: 0, y: 0 },
            { x: 0.25, y: 0 },
            { x: 0.8, y: 1 },
            { x: 1, y: 1 },
        ]);
    });
});
