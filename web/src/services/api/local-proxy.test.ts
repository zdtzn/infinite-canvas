import { expect, test } from "bun:test";
import { withLocalProxy } from "./local-proxy";
import { normalizeLocalProxyUrl, useLocalProxyStore } from "@/stores/use-local-proxy-store";
import { openAiApiUrl, geminiApiBase, type ManagedAiConfig } from "./gateway";

test("proxy is optional and validates loopback-only origin configuration", () => {
    for (const url of ["https://evil.example", "http://localhost.evil.test", "file:///test", "http://user:pass@localhost", "http://localhost/path", "http://localhost/?x=1"]) expect(normalizeLocalProxyUrl(url)).toBe("");
    expect(normalizeLocalProxyUrl("http://[::1]:8789/")).toBe("http://[::1]:8789");
    useLocalProxyStore.setState({ enabled: false });
    expect(withLocalProxy("https://api.example/v1")).toBe("https://api.example/v1");
});

test("managed routes bypass enabled proxy and direct URL query escapes are preserved", () => {
    useLocalProxyStore.setState({ enabled: true, url: "http://127.0.0.1:8789" });
    try {
        expect(withLocalProxy("/api/assets/private")).toBe("/api/assets/private");
        const config = { channelId: "channel", serverManaged: true } as ManagedAiConfig;
        expect(openAiApiUrl(config, "/models")).toBe("/api/ai/channel/openai/models");
        expect(geminiApiBase(config)).toBe("/api/ai/channel/gemini");
        const result = withLocalProxy("https://api.example/v1?key=a%2Fb&x=1");
        expect(result).toBe("http://127.0.0.1:8789/proxy/https://api.example/v1?key=a%2Fb&x=1");
        expect(withLocalProxy(result)).toBe(result);
    } finally {
        useLocalProxyStore.setState({ enabled: false });
    }
});
