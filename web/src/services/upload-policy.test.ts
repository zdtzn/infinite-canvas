import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assertImageUploadAllowed, IMAGE_UPLOAD_LIMITS } from "./upload-policy";

describe("image upload policy", () => {
    test("accepts a normal PNG", () => {
        assert.doesNotThrow(() => assertImageUploadAllowed({ bytes: 2_000_000, mimeType: "image/png", width: 2048, height: 2048 }));
    });

    test("rejects unsupported, oversized and pixel-bomb images", () => {
        assert.throws(() => assertImageUploadAllowed({ bytes: 10, mimeType: "image/svg+xml", width: 10, height: 10 }), /格式/);
        assert.throws(() => assertImageUploadAllowed({ bytes: IMAGE_UPLOAD_LIMITS.maxBytes + 1, mimeType: "image/png", width: 10, height: 10 }), /大小/);
        assert.throws(() => assertImageUploadAllowed({ bytes: 10, mimeType: "image/png", width: 12_000, height: 12_000 }), /像素/);
    });
});
