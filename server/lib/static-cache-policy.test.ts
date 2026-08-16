import { describe, expect, test } from "bun:test";

import { staticCacheControl } from "./static-cache-policy";

describe("staticCacheControl", () => {
  test("keeps versioned cutout runtime files immutable", () => {
    expect(
      staticCacheControl(
        "/background-removal/1.7.0/onnxruntime-web/ort-wasm-simd-threaded.wasm",
      ),
    ).toBe("public, max-age=31536000, immutable");
    expect(
      staticCacheControl("/background-removal/1.7.0/models/isnet_fp16_0"),
    ).toBe("public, max-age=31536000, immutable");
  });

  test("revalidates the cutout resource manifest", () => {
    expect(staticCacheControl("/background-removal/1.7.0/resources.json")).toBe(
      "no-cache",
    );
  });

  test("preserves the existing frontend cache policy", () => {
    expect(staticCacheControl("/index.html")).toBe("no-cache");
    expect(staticCacheControl("/assets/index-AbCdEf12.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl("/favicon.ico")).toBe("public, max-age=3600");
  });
});
