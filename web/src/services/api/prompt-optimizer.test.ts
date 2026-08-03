import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPromptOptimizationRequest } from "./prompt-optimizer";

test("prompt optimization never sends a text channel or model from the browser", () => {
    const request = buildPromptOptimizationRequest("东方云海", {
        imageModel: "gpt-image-2",
        aspectRatio: "3:4",
        resolution: "medium",
        referenceCount: 1,
        editMode: true,
        source: "canvas",
    });

    assert.deepEqual(request, {
        prompt: "东方云海",
        context: {
            imageModel: "gpt-image-2",
            aspectRatio: "3:4",
            resolution: "medium",
            referenceCount: 1,
            editMode: true,
            source: "canvas",
        },
    });
    assert.equal("channelId" in request, false);
    assert.equal("model" in request, false);
});
