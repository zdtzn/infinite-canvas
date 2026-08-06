import { expect, test } from "bun:test";

import { buildSadaiImageRequestOptions, isSadaiImage2Channel } from "./sadai-image";

test("uses the SADAI Image2 adapter only for the documented API host", () => {
    expect(isSadaiImage2Channel("https://api.sadai.top/v1", "gpt-image-2")).toBe(true);
    expect(isSadaiImage2Channel("https://sadai.cc/v1", "gpt-image-2")).toBe(false);
    expect(isSadaiImage2Channel("https://api.sadai.top/v1", "gpt-image-1")).toBe(false);
});

test("maps workbench ratio and resolution to SADAI Image2 fields", () => {
    expect(
        buildSadaiImageRequestOptions({
            count: 1,
            size: "9:16",
            outputResolution: "low",
            references: [],
        }),
    ).toEqual({ n: 1, aspect_ratio: "9:16", resolution: "1k", response_format: "b64_json" });

    expect(
        buildSadaiImageRequestOptions({
            count: 2,
            size: "2048x1152",
            outputResolution: "medium",
            generationQuality: "high",
            references: ["data:image/png;base64,reference"],
        }),
    ).toEqual({
        n: 2,
        aspect_ratio: "16:9",
        resolution: "2k",
        quality: "high",
        response_format: "b64_json",
        images: ["data:image/png;base64,reference"],
    });
});

test("migrates legacy automatic ratios to square and reduces explicit dimensions", () => {
    expect(
        buildSadaiImageRequestOptions({
            count: 1,
            size: "auto",
            outputResolution: "auto",
            generationQuality: "auto",
            references: [],
        }),
    ).toEqual({ n: 1, aspect_ratio: "1:1", response_format: "b64_json" });

    expect(
        buildSadaiImageRequestOptions({
            count: 1,
            size: "1408x1056",
            outputResolution: "high",
            references: [],
        }),
    ).toEqual({ n: 1, aspect_ratio: "4:3", resolution: "4k", response_format: "b64_json" });
});

test("supports the latest documented SADAI Image2 mapped ratios", () => {
    for (const size of ["1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3"]) {
        expect(
            buildSadaiImageRequestOptions({
                count: 1,
                size,
                outputResolution: "low",
                references: [],
            }).aspect_ratio,
        ).toBe(size);
    }
});

test("rejects ratios outside the documented SADAI Image2 mapped group", () => {
    expect(() =>
        buildSadaiImageRequestOptions({
            count: 1,
            size: "9:21",
            outputResolution: "low",
            references: [],
        }),
    ).toThrow("SADAI Image2 does not support aspect ratio 3:7");
});
