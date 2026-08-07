import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  createResultImageRelayConfig,
  relaySignaturePayload,
  resultImageDownloadUrl,
} from "../../../server/lib/result-image-relay";
import worker, { verifyRelayRequest } from "./worker";

const secret = "test-secret-that-is-at-least-32-characters-long";
const nowSeconds = 1_700_000_000;

describe("Cloudflare result relay verification", () => {
  test("accepts a URL signed by the application server", async () => {
    const config = createResultImageRelayConfig(
      "https://image-relay.example.workers.dev/fetch",
      secret,
      120,
    );
    const target =
      "https://img.uuapi.net/uu-image-temp/job/result.png?token=temporary";
    const request = new Request(
      resultImageDownloadUrl(target, config, nowSeconds * 1000),
    );

    await expect(
      verifyRelayRequest(
        request,
        { RESULT_IMAGE_RELAY_SECRET: secret },
        nowSeconds,
      ),
    ).resolves.toEqual(new URL(target));
  });

  test("rejects expired and tampered requests", async () => {
    const config = createResultImageRelayConfig(
      "https://image-relay.example.workers.dev/fetch",
      secret,
      30,
    );
    const target =
      "https://img.uuapi.net/uu-image-temp/job/result.png?token=temporary";
    const signed = resultImageDownloadUrl(target, config, nowSeconds * 1000);

    await expect(
      verifyRelayRequest(
        new Request(signed),
        { RESULT_IMAGE_RELAY_SECRET: secret },
        nowSeconds + 31,
      ),
    ).rejects.toThrow("expired");

    const tampered = new URL(signed);
    tampered.searchParams.set(
      "target",
      "https://img.uuapi.net/uu-image-temp/job/other.png",
    );
    await expect(
      verifyRelayRequest(
        new Request(tampered),
        { RESULT_IMAGE_RELAY_SECRET: secret },
        nowSeconds,
      ),
    ).rejects.toThrow("Invalid signature");
  });

  test("rejects a correctly signed URL outside the strict allowlist", async () => {
    const target = "https://example.com/uu-image-temp/result.png";
    const expires = nowSeconds + 120;
    const signature = createHmac("sha256", secret)
      .update(relaySignaturePayload(target, expires))
      .digest("hex");
    const requestUrl = new URL("https://image-relay.example.workers.dev/fetch");
    requestUrl.searchParams.set("target", target);
    requestUrl.searchParams.set("expires", String(expires));
    requestUrl.searchParams.set("signature", signature);

    await expect(
      verifyRelayRequest(
        new Request(requestUrl),
        { RESULT_IMAGE_RELAY_SECRET: secret },
        nowSeconds,
      ),
    ).rejects.toThrow("not allowed");
  });

  test("returns a validated image with browser-safe CORS headers", async () => {
    const currentSeconds = Math.floor(Date.now() / 1000);
    const config = createResultImageRelayConfig(
      "https://image-relay.example.workers.dev/fetch",
      secret,
      120,
    );
    const request = new Request(
      resultImageDownloadUrl(
        "https://img.uuapi.net/uu-image-temp/job/result.png",
        config,
        currentSeconds * 1000,
      ),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        { headers: { "Content-Type": "application/octet-stream" } },
      )) as typeof fetch;

    try {
      const response = await worker.fetch(request, {
        RESULT_IMAGE_RELAY_SECRET: secret,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toContain("no-store");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
