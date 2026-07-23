import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deriveImageModelCapabilities, validateImageRequest } from "./model-capabilities";

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
        assert.throws(() => validateImageRequest(capabilities, { resolution: "medium", imageOutputFormat: "jpeg", size: "1:1", background: "transparent", referenceCount: 0 }), /JPEG/);
    });

    test("UU async GPT Image keeps quality automatic but allows a locally encoded output format", () => {
        const capabilities = deriveImageModelCapabilities("uuapi::gpt-image-2", "openai", "https://uuapi.net/v1");
        assert.deepEqual(capabilities.generationQualities, ["auto"]);
        assert.deepEqual(capabilities.outputFormats, ["auto"]);
        assert.doesNotThrow(() => validateImageRequest(capabilities, { resolution: "medium", imageOutputFormat: "jpeg", size: "1:1", background: "", referenceCount: 0 }));
    });
});
