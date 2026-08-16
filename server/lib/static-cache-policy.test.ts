import { describe, expect, test } from "bun:test";

import { staticCacheControl } from "./static-cache-policy";

describe("staticCacheControl", () => {
  test("preserves the existing frontend cache policy", () => {
    expect(staticCacheControl("/index.html")).toBe("no-cache");
    expect(staticCacheControl("/assets/index-AbCdEf12.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl("/favicon.ico")).toBe("public, max-age=3600");
  });
});
