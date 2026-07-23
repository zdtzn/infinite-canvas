import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { promptImageCandidates, promptOriginalCandidates, promptOriginalUrl, promptThumbnailUrl } from "./prompt-cover";

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

    test("prefers the cached server thumbnail and keeps direct sources as fallbacks", () => {
        const proxy = "/prompt-proxy/raw/freestylefly/awesome-gpt-image-2/main/data/images/case1.jpg";
        const candidates = promptImageCandidates(proxy);

        assert.equal(candidates.length, 4);
        assert.ok(candidates[0].startsWith("/prompt-proxy/thumbnail/?url="));
        assert.equal(candidates[1], proxy);
        assert.equal(candidates[2], "https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data/images/case1.jpg");
        assert.ok(candidates[3].startsWith("https://images.weserv.nl/"));
    });

    test("routes raw GitHub URLs through the direct CDN", () => {
        assert.equal(
            promptOriginalUrl("https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/case1.jpg"),
            "https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data/images/case1.jpg",
        );
    });

    test("uses the server proxy before the direct CDN when downloading an original", () => {
        const proxy = "/prompt-proxy/raw/freestylefly/awesome-gpt-image-2/main/data/images/case1.jpg";

        assert.deepEqual(promptOriginalCandidates(proxy), [proxy, "https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data/images/case1.jpg"]);
    });
});
