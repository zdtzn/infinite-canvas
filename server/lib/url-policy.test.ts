import { describe, expect, test } from "bun:test";

import {
    assertAllowedUpstreamUrl,
    buildUpstreamUrl,
    isLoopbackAddress,
    isLoopbackRequestUrl,
    isLoopbackSetupRequest,
    isSameApplicationOrigin,
    normalizePublicBaseUrl,
    resolveAllowedRedirect,
} from "./url-policy";

describe("upstream URL policy", () => {
    test("accepts public HTTPS providers and normalizes OpenAI paths", () => {
        expect(buildUpstreamUrl("https://api.example.com", "openai", "/images/generations")).toBe("https://api.example.com/v1/images/generations");
        expect(() => assertAllowedUpstreamUrl("https://api.example.com/v1")).not.toThrow();
    });

    test("rejects local and private-network targets", () => {
        for (const value of ["http://127.0.0.1:8080", "http://localhost:3000", "http://10.0.0.2", "http://192.168.1.8", "http://169.254.169.254", "http://0.0.0.0", "https://[::1]", "https://[fc00::1]", "file:///etc/passwd"]) {
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

    test("normalizes the public origin and rejects malformed deployment URLs", () => {
        expect(normalizePublicBaseUrl("https://canvas.example.com/")).toBe("https://canvas.example.com");
        expect(normalizePublicBaseUrl("")).toBe("");
        expect(() => normalizePublicBaseUrl("https://canvas.example.com/app")).toThrow("不能包含路径");
        expect(() => normalizePublicBaseUrl("https://user:pass@canvas.example.com")).toThrow("标准 HTTP(S)");
    });

    test("compares the browser origin with the configured public origin", () => {
        expect(isSameApplicationOrigin("http://app:3000/api/jobs", "https://canvas.example.com", "https://canvas.example.com")).toBe(true);
        expect(isSameApplicationOrigin("http://app:3000/api/jobs", "http://canvas.example.com", "https://canvas.example.com")).toBe(false);
        expect(isSameApplicationOrigin("http://127.0.0.1:3000/api/jobs", "http://127.0.0.1:3000")).toBe(true);
        expect(isSameApplicationOrigin("http://127.0.0.1:3000/api/jobs", "not-an-origin")).toBe(false);
    });

    test("allows first-administrator setup only through a loopback host", () => {
        expect(isLoopbackRequestUrl("http://127.0.0.1:3000/api/auth/setup")).toBe(true);
        expect(isLoopbackRequestUrl("http://localhost:3000/api/auth/setup")).toBe(true);
        expect(isLoopbackRequestUrl("http://[::1]:3000/api/auth/setup")).toBe(true);
        expect(isLoopbackRequestUrl("https://canvas.example.com/api/auth/setup")).toBe(false);
        expect(isLoopbackRequestUrl("http://118.190.159.129:3000/api/auth/setup")).toBe(false);
    });

    test("requires the administrator setup peer itself to be loopback", () => {
        expect(isLoopbackAddress("127.0.0.1")).toBe(true);
        expect(isLoopbackAddress("127.12.34.56")).toBe(true);
        expect(isLoopbackAddress("::1")).toBe(true);
        expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
        expect(isLoopbackAddress("118.190.159.129")).toBe(false);
        expect(isLoopbackSetupRequest("http://127.0.0.1:3000/api/auth/setup", "118.190.159.129")).toBe(false);
        expect(isLoopbackSetupRequest("https://canvas.example.com/api/auth/setup", "127.0.0.1")).toBe(false);
        expect(isLoopbackSetupRequest("http://127.0.0.1:3000/api/auth/setup", "127.0.0.1")).toBe(true);
    });
});
