import { expect, test } from "bun:test";

import { serverImageReferenceInput } from "./image";

test("uses compact server asset handles instead of embedding uploaded reference images", () => {
    const references = Array.from({ length: 4 }, (_, index) => serverImageReferenceInput({ storageKey: `image:reference-${index}` }));

    expect(references).toEqual([{ assetKey: "image:reference-0" }, { assetKey: "image:reference-1" }, { assetKey: "image:reference-2" }, { assetKey: "image:reference-3" }]);
    expect(JSON.stringify({ references }).length).toBeLessThan(256);
});

test("falls back to image data for references that are not server image assets", () => {
    expect(serverImageReferenceInput({ storageKey: "" })).toBeNull();
    expect(serverImageReferenceInput({ storageKey: "file:reference" })).toBeNull();
    expect(serverImageReferenceInput({})).toBeNull();
});
