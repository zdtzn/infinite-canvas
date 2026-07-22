import { expect, test } from "bun:test";

import { openAiApiUrl, providerHeaders, type ManagedAiConfig } from "./gateway";

test("routes server-managed model requests through the authenticated backend proxy", () => {
    const config = { channelId: "uuapi", serverManaged: true, baseUrl: "https://uuapi.cc", apiKey: "" } as ManagedAiConfig;

    expect(openAiApiUrl(config, "/models")).toBe("/api/ai/uuapi/openai/models");
    expect(providerHeaders(config)).not.toHaveProperty("Authorization");
});

test("keeps local model requests pointed at the configured OpenAI-compatible endpoint", () => {
    const config = { channelId: "uuapi", serverManaged: false, baseUrl: "https://uuapi.cc", apiKey: "test-key" } as ManagedAiConfig;

    expect(openAiApiUrl(config, "/models")).toBe("https://uuapi.cc/v1/models");
    expect(providerHeaders(config).Authorization).toBe("Bearer test-key");
});
