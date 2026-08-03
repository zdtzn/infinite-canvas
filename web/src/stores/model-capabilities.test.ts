import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deriveImageModelCapabilities, resolveImageSlotConcurrency, validateImageRequest } from "./model-capabilities";

describe("image model capabilities", () => {
    test("Gemini disables transparent output and limits references", () => {
        const capabilities = deriveImageModelCapabilities("gemini-3-pro-image-preview", "gemini");
        assert.equal(capabilities.transparentBackground, false);
        assert.equal(capabilities.maxReferences, 10);
        assert.throws(() => validateImageRequest(capabilities, { resolution: "high", size: "16:9", background: "transparent", referenceCount: 0 }), /透明背景/);
    });

    test("rejects unsupported resolutions, generation qualities and reference counts before billing", () => {
        const capabilities = deriveImageModelCapabilities("unknown-image", "openai");
        assert.throws(() => validateImageRequest(capabilities, { resolution: "ultra", size: "1:1", background: "", referenceCount: 0 }), /输出分辨率/);
        assert.throws(() => validateImageRequest(capabilities, { resolution: "low", imageQuality: "high", size: "1:1", background: "", referenceCount: 0 }), /生成质量/);
        assert.throws(() => validateImageRequest(capabilities, { resolution: "low", size: "1:1", background: "", referenceCount: capabilities.maxReferences + 1 }), /参考图/);
    });

    test("allows GPT Image output resolution and generation quality to be selected independently", () => {
        const capabilities = deriveImageModelCapabilities("gpt-image-2", "openai");
        assert.deepEqual(capabilities.generationQualities, ["auto", "low", "medium", "high"]);
        assert.deepEqual(capabilities.outputFormats, ["auto", "png", "jpeg", "webp"]);
        assert.doesNotThrow(() => validateImageRequest(capabilities, { resolution: "medium", imageQuality: "high", imageOutputFormat: "webp", size: "1:1", background: "", referenceCount: 0 }));
        assert.throws(() => validateImageRequest(capabilities, { resolution: "medium", imageOutputFormat: "jpeg", size: "1:1", background: "transparent", referenceCount: 0 }), /透明背景/);
    });

    test("UU async GPT Image exposes 4K but serializes multi-image submissions", () => {
        const capabilities = deriveImageModelCapabilities("uuapi::gpt-image-2", "openai", "https://uuapi.net/v1");
        assert.deepEqual(capabilities.resolutions, ["low", "medium", "high"]);
        assert.equal(capabilities.customSize, false);
        assert.deepEqual(capabilities.generationQualities, ["auto"]);
        assert.deepEqual(capabilities.outputFormats, ["auto"]);
        assert.doesNotThrow(() => validateImageRequest(capabilities, { resolution: "medium", imageOutputFormat: "jpeg", size: "1:1", background: "", referenceCount: 0 }));
        assert.equal(resolveImageSlotConcurrency("https://uuapi.net/v1", "uuapi::gpt-image-2", 4), 1);
        assert.equal(resolveImageSlotConcurrency("https://api.example.com/v1", "gpt-image-2", 4), 4);
    });

    test("SADAI exposes ratios and quality without claiming exact pixels or transparency", () => {
        const capabilities = deriveImageModelCapabilities("gpt-image-2", "openai", "https://api.sadai.top/v1");
        assert.equal(capabilities.customSize, false);
        assert.equal(capabilities.transparentBackground, false);
        assert.deepEqual(capabilities.outputFormats, ["auto"]);
        assert.deepEqual(capabilities.sizes, ["1:1", "4:3", "3:4", "16:9", "9:16"]);
    });

    test("standard GPT Image 2 channels expose the documented flexible ratio range", () => {
        for (const baseUrl of ["https://yundu.lat", "https://chiyicn.com/v1", "https://tken.me", "https://api-slb.muskapi.cc"]) {
            const capabilities = deriveImageModelCapabilities("gpt-image-2", "openai", baseUrl);
            assert.equal(capabilities.customSize, true);
            assert.equal(capabilities.transparentBackground, false);
            assert.deepEqual(capabilities.sizes, ["1:1", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21", "3:1", "1:3"]);
        }

        const uu = deriveImageModelCapabilities("gpt-image-2", "openai", "https://uuapi.cc");
        assert.equal(uu.customSize, false);
        assert.deepEqual(uu.sizes, ["1:1", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21", "3:1", "1:3"]);
    });

    test("older GPT Image models keep their documented fixed size choices", () => {
        const capabilities = deriveImageModelCapabilities("gpt-image-1.5", "openai");
        assert.deepEqual(capabilities.resolutions, ["low"]);
        assert.equal(capabilities.customSize, false);
        assert.deepEqual(capabilities.sizes, ["1:1", "3:2", "2:3"]);
    });

    test("Gemini models without imageSize support keep resolution automatic", () => {
        assert.deepEqual(deriveImageModelCapabilities("gemini-2.5-flash-image", "gemini").resolutions, ["auto"]);
        assert.deepEqual(deriveImageModelCapabilities("gemini-3-pro-image-preview", "gemini").resolutions, ["low", "medium", "high"]);
    });
});
