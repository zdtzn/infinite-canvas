import { describe, expect, test } from "bun:test";

import { hasAgentUrlBootstrap, readAgentUrlBootstrap } from "./agent-url-bootstrap";

describe("Agent fragment bootstrap", () => {
    test("reads encoded credentials and removes every credential while retaining unrelated hash params", () => {
        const params = new URLSearchParams({ agentUrl: " https://agent.example/path?mode=local&port=17371 ", agentToken: " token+with/equals= ", tab: "history" });
        params.append("agentToken", "duplicate-secret");
        const hash = `#${params}`;
        expect(hasAgentUrlBootstrap(hash)).toBe(true);
        expect(readAgentUrlBootstrap(hash)).toEqual({ url: "https://agent.example/path?mode=local&port=17371", token: "token+with/equals=", remainingHash: "#tab=history" });
    });

    test("detects incomplete credentials for setup errors and clears them", () => {
        expect(readAgentUrlBootstrap("#agentUrl=http%3A%2F%2F127.0.0.1%3A17371")).toEqual({ url: "http://127.0.0.1:17371", token: "", remainingHash: "" });
        expect(readAgentUrlBootstrap("#agentToken=secret")).toEqual({ url: "", token: "secret", remainingHash: "" });
        expect(readAgentUrlBootstrap("#agentUrl=&agentToken=")).toEqual({ url: "", token: "", remainingHash: "" });
    });

    test("keeps ordinary anchors out of the bootstrap flow", () => {
        for (const hash of ["", "#section", "#tab=history"]) {
            expect(hasAgentUrlBootstrap(hash)).toBe(false);
            expect(readAgentUrlBootstrap(hash)).toBeNull();
        }
    });
});
