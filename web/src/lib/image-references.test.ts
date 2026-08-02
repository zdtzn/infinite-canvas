import { expect, test } from "bun:test";

import { limitImageReferenceAdditions } from "./image-references";

test("reference additions share one model limit", () => {
    const result = limitImageReferenceAdditions(["existing"], ["a", "b", "c"], 3);
    expect(result.items).toEqual(["existing", "a", "b"]);
    expect(result.added).toBe(2);
    expect(result.rejected).toBe(1);
});
