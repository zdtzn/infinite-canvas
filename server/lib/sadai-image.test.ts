import { expect, test } from "bun:test";

import { buildSadaiImageRequestOptions, isSadaiImage25Channel, isSadaiImage2Channel, sadaiImageBaseUrl } from "./sadai-image";

test("recognizes only SADAI 2.5 models on official standard HTTPS entries for URL delivery", () => {
    for (const origin of ["https://verysadai.com", "https://sadai.cc", "https://sadai.top", "https://api.sadai.top"]) {
        for (const path of ["", "/", "/v1", "/v1/"]) {
            for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
                expect(isSadaiImage25Channel(`${origin}${path}`, model)).toBe(true);
            }
        }
    }
    for (const model of ["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare-custom"]) {
        expect(isSadaiImage25Channel("https://api.sadai.top/v1", model)).toBe(false);
    }
    for (const baseUrl of [
        "https://proxy.example.com/v1", "https://verysadai.com/custom/v1", "https://api.sadai.top/custom/v1",
        "http://api.sadai.top/v1", "https://api.sadai.top:443/v1", "https://user@api.sadai.top/v1",
        "https://api.sadai.top/v1?route=custom", "https://api.sadai.top/v1#custom", "https://api.sadai.top./v1",
        "https://api.sadai.top.proxy.example.com/v1", "invalid URL",
    ]) {
        expect(isSadaiImage25Channel(baseUrl, "gpt-image-2.5-flare")).toBe(false);
    }
});

test("routes documented SADAI 2.5 models from standard API entries to the dedicated image endpoint", () => {
    for (const origin of ["https://verysadai.com", "https://sadai.cc", "https://sadai.top"]) {
        for (const path of ["", "/", "/v1", "/v1/"]) {
            for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
                expect(sadaiImageBaseUrl(`${origin}${path}`, model)).toBe("https://api.sadai.top/v1");
            }
        }
    }
});

test("preserves SADAI legacy adapters, other models, proxies and customized API entries", () => {
    for (const model of ["gpt-image-2", "gpt-image-1.5", "gpt-image-2.5", "gpt-image-2.5-flare-custom", "gpt-5.4"]) {
        expect(sadaiImageBaseUrl("https://verysadai.com/v1", model)).toBe("https://verysadai.com/v1");
    }
    for (const baseUrl of [
        "https://api.sadai.top/v1",
        "https://proxy.example.com/v1",
        "https://verysadai.com.proxy.example.com/v1",
        "https://verysadai.com./v1",
        "http://verysadai.com/v1",
        "https://verysadai.com:443/v1",
        "https://verysadai.com:8443/v1",
        "https://user@verysadai.com/v1",
        "https://user:password@verysadai.com/v1",
        "https://verysadai.com/v1?route=custom",
        "https://verysadai.com/v1?",
        "https://verysadai.com/v1#custom",
        "https://verysadai.com/v1#",
        "https://verysadai.com/custom/v1",
        "https://verysadai.com/v1/images/generations",
        "https://verysadai.com/v1//",
        "https://verysadai.com/custom/../v1",
        "invalid URL",
    ]) {
        expect(sadaiImageBaseUrl(baseUrl, "gpt-image-2.5-flare")).toBe(baseUrl);
    }
});

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
