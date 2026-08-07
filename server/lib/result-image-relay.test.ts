import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  createResultImageRelayConfig,
  isRelayEligibleResultUrl,
  relaySignaturePayload,
  resultImageDownloadUrl,
} from "./result-image-relay";

const secret = "test-secret-that-is-at-least-32-characters-long";

describe("result image relay", () => {
  test("signs a short-lived UU temporary image request", () => {
    const config = createResultImageRelayConfig(
      "https://image-relay.example.workers.dev/fetch",
      secret,
      120,
    );
    const target =
      "https://img.uuapi.net/uu-image-temp/job/result.png?token=temporary";
    const relayed = new URL(
      resultImageDownloadUrl(target, config, 1_700_000_000_000),
    );
    const expires = 1_700_000_120;

    expect(relayed.origin + relayed.pathname).toBe(
      "https://image-relay.example.workers.dev/fetch",
    );
    expect(relayed.searchParams.get("target")).toBe(target);
    expect(relayed.searchParams.get("expires")).toBe(String(expires));
    expect(relayed.searchParams.get("signature")).toBe(
      createHmac("sha256", secret)
        .update(relaySignaturePayload(target, expires))
        .digest("hex"),
    );
  });

  test("only relays the documented UU temporary image host and path", () => {
    expect(
      isRelayEligibleResultUrl(
        "https://img.uuapi.net/uu-image-temp/job/result.png",
      ),
    ).toBe(true);
    expect(
      isRelayEligibleResultUrl("https://img.uuapi.net/other/result.png"),
    ).toBe(false);
    expect(
      isRelayEligibleResultUrl(
        "https://img.uuapi.net.evil.example/uu-image-temp/result.png",
      ),
    ).toBe(false);
    expect(
      isRelayEligibleResultUrl(
        "https://img.uuapi.net/uu-image-temp/result.png#fragment",
      ),
    ).toBe(false);
  });

  test("leaves unrelated image URLs unchanged", () => {
    const config = createResultImageRelayConfig(
      "https://image-relay.example.workers.dev/fetch",
      secret,
    );
    const target = "https://images.example.com/result.png";
    expect(resultImageDownloadUrl(target, config)).toBe(target);
  });

  test("requires the endpoint and secret together", () => {
    expect(() =>
      createResultImageRelayConfig(
        "https://image-relay.example.workers.dev/fetch",
        "",
      ),
    ).toThrow("must be configured together");
    expect(() => createResultImageRelayConfig("", secret)).toThrow(
      "must be configured together",
    );
  });
});
