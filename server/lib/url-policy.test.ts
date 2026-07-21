import { describe, expect, test } from "bun:test";

import { assertAllowedUpstreamUrl, buildUpstreamUrl, resolveAllowedRedirect } from "./url-policy";

describe("upstream URL policy", () => {
    test("accepts public HTTPS providers and normalizes OpenAI paths", () => {
        expect(buildUpstreamUrl("https://api.example.com", "openai", "/images/generations")).toBe("https://api.example.com/v1/images/generations");
        expect(() => assertAllowedUpstreamUrl("https://api.example.com/v1")).not.toThrow();
    });

    test("rejects local and private-network targets", () => {
        for (const value of ["http://127.0.0.1:8080", "http://localhost:3000", "http://10.0.0.2", "http://192.168.1.8", "file:///etc/passwd"]) {
            expect(() => assertAllowedUpstreamUrl(value)).toThrow();
        }
    });

    test("builds Gemini model paths under v1beta", () => {
        expect(buildUpstreamUrl("https://generativelanguage.googleapis.com", "gemini", "/models/gemini-3:generateContent")).toBe(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3:generateContent",
        );
    });

    test("validates every redirect target instead of trusting the first URL", () => {
        expect(resolveAllowedRedirect("https://api.example.com/v1/models", "/v2/models").toString()).toBe("https://api.example.com/v2/models");
        expect(() => resolveAllowedRedirect("https://api.example.com/v1/models", "https://127.0.0.1/admin")).toThrow("内网");
        expect(() => resolveAllowedRedirect("https://api.example.com/v1/models", "http://api.example.com/v2/models")).toThrow("HTTPS");
    });
});
