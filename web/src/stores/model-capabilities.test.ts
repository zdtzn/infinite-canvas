import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deriveImageModelCapabilities, validateImageRequest } from "./model-capabilities";

describe("image model capabilities", () => {
    test("Gemini disables transparent output and limits references", () => {
        const capabilities = deriveImageModelCapabilities("gemini-3-pro-image-preview", "gemini");
        assert.equal(capabilities.transparentBackground, false);
        assert.equal(capabilities.maxReferences, 10);
        assert.throws(() => validateImageRequest(capabilities, { quality: "high", size: "16:9", background: "transparent", referenceCount: 0 }), /透明背景/);
    });

    test("rejects unsupported reference counts and qualities before billing", () => {
        const capabilities = deriveImageModelCapabilities("unknown-image", "openai");
        assert.throws(() => validateImageRequest(capabilities, { quality: "ultra", size: "1:1", background: "", referenceCount: 0 }), /质量/);
        assert.throws(() => validateImageRequest(capabilities, { quality: "auto", size: "1:1", background: "", referenceCount: capabilities.maxReferences + 1 }), /参考图/);
    });
});
