import type { ColorCurve } from "./types";

const CURVE_LUT_SIZE = 256;

export function buildColorCurveLut(curve: ColorCurve) {
    const points = curve.length >= 2 ? curve : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const slopes = points.slice(0, -1).map((point, index) => {
        const next = points[index + 1];
        return (next.y - point.y) / Math.max(0.0001, next.x - point.x);
    });
    const tangents = points.map((_, index) => {
        if (index === 0) return slopes[0];
        if (index === points.length - 1) return slopes.at(-1)!;
        const before = slopes[index - 1];
        const after = slopes[index];
        if (before === 0 || after === 0 || before * after < 0) return 0;
        return (2 * before * after) / (before + after);
    });
    const lut = new Float32Array(CURVE_LUT_SIZE);
    let segment = 0;

    for (let index = 0; index < CURVE_LUT_SIZE; index += 1) {
        const input = index / (CURVE_LUT_SIZE - 1);
        while (segment < points.length - 2 && input > points[segment + 1].x) segment += 1;
        const left = points[segment];
        const right = points[segment + 1];
        const width = Math.max(0.0001, right.x - left.x);
        const t = Math.min(1, Math.max(0, (input - left.x) / width));
        const t2 = t * t;
        const t3 = t2 * t;
        const value =
            (2 * t3 - 3 * t2 + 1) * left.y +
            (t3 - 2 * t2 + t) * width * tangents[segment] +
            (-2 * t3 + 3 * t2) * right.y +
            (t3 - t2) * width * tangents[segment + 1];
        lut[index] = Math.min(1, Math.max(0, value));
    }

    return lut;
}

export function sampleColorCurveLut(lut: Float32Array, value: number) {
    const position = Math.min(1, Math.max(0, value)) * (lut.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(lut.length - 1, lower + 1);
    const amount = position - lower;
    return lut[lower] + (lut[upper] - lut[lower]) * amount;
}

export function colorCurveIsNeutral(curve: ColorCurve) {
    return curve.every((point) => Math.abs(point.x - point.y) < 0.0001);
}

export function blendColorCurves(left: ColorCurve, right: ColorCurve, amount: number): ColorCurve {
    const leftLut = buildColorCurveLut(left);
    const rightLut = buildColorCurveLut(right);
    const inputs = Array.from(new Set([...left.map((point) => point.x), ...right.map((point) => point.x)])).sort((a, b) => a - b);
    return inputs.map((x) => ({
        x,
        y: roundCurveValue(sampleColorCurveLut(leftLut, x) + (sampleColorCurveLut(rightLut, x) - sampleColorCurveLut(leftLut, x)) * amount),
    }));
}

function roundCurveValue(value: number) {
    return Math.round(value * 10_000) / 10_000;
}
