import { expect, test } from "bun:test";
import { planChannelImport } from "./channel-import";
import { createModelChannel } from "@/stores/use-config-store";

test("URL import updates the matching endpoint instead of the first channel", () => {
    const first = createModelChannel({ id: "first", baseUrl: "https://first.test", apiKey: "keep" });
    const second = createModelChannel({ id: "second", baseUrl: "https://second.test/v1/", apiKey: "old", apiFormat: "gemini" });
    const result = planChannelImport([first, second], "https://SECOND.test/v1", "new");
    expect(result.created).toBe(false);
    expect(result.channel).toMatchObject({ id: "second", apiKey: "new", apiFormat: "gemini" });
    expect(first.apiKey).toBe("keep");
    expect(second.apiKey).toBe("old");
});

test("new endpoint gets a new channel and missing key preserves an existing key", () => {
    const channel = createModelChannel({ baseUrl: "https://api.test", apiKey: "keep" });
    expect(planChannelImport([channel], "https://api.test/", " ").channel.apiKey).toBe("keep");
    const imported = planChannelImport([channel], "https://new.test/v1", "key");
    expect(imported.created).toBe(true);
    expect(imported.channel.id).not.toBe(channel.id);
    expect(imported.channel.credentialState).toBe("missing");
});

test("invalid, credential-bearing or missing BaseURL cannot overwrite configuration", () => {
    for (const url of [null, "", "api.test", "javascript:alert(1)", "https://key@api.test", "https://api.test?key=secret", "https://api.test#fragment"]) {
        expect(() => planChannelImport([], url, "key")).toThrow();
    }
});
