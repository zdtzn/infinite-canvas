import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { promptOriginalUrl, promptThumbnailUrl } from "./prompt-cover";

describe("prompt image URLs", () => {
    test("routes GitHub originals directly through jsDelivr", () => {
        assert.equal(
            promptOriginalUrl("/prompt-proxy/raw/freestylefly/awesome-gpt-image-2/main/data/images/case1.jpg"),
            "https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data/images/case1.jpg",
        );
    });

    test("creates a lightweight thumbnail from the direct original URL", () => {
        const original = "https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data/images/case1.jpg";
        const thumbnail = promptThumbnailUrl("/prompt-proxy/raw/freestylefly/awesome-gpt-image-2/main/data/images/case1.jpg");

        assert.ok(thumbnail.includes(encodeURIComponent(original)));
        assert.ok(thumbnail.includes("w=640"));
        assert.ok(thumbnail.includes("output=webp"));
    });
});
