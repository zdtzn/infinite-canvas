import { describe, expect, test } from "bun:test";

import { createIdentityToken, createSessionToken, hashAccessCode, personalPasswordIssue, readCookie, readIdentityToken, readSessionToken, verifyAccessCode } from "./auth";

describe("server authentication", () => {
    test("hashes access codes without storing the original value", async () => {
        const encoded = await hashAccessCode("friend-only-code");
        expect(encoded).not.toContain("friend-only-code");
        expect(await verifyAccessCode("friend-only-code", encoded)).toBe(true);
        expect(await verifyAccessCode("wrong-code", encoded)).toBe(false);
    });

    test("signs expiring session tokens and rejects tampering", () => {
        const token = createSessionToken({ userId: "user-1", displayName: "测试用户" }, "secret", 60_000, 1_000);
        expect(readSessionToken(token, "secret", 2_000)?.userId).toBe("user-1");
        expect(readSessionToken(`${token}x`, "secret", 2_000)).toBeNull();
        expect(readSessionToken(token, "secret", 70_000)).toBeNull();
    });

    test("binds a persistent device identity without trusting a display name", () => {
        const token = createIdentityToken("user-1", "secret", 60_000, 1_000);
        expect(readIdentityToken(token, "secret", 2_000)).toBe("user-1");
        expect(readIdentityToken(`${token}x`, "secret", 2_000)).toBeNull();
        expect(readIdentityToken(token, "secret", 70_000)).toBeNull();
    });

    test("treats malformed cookie encoding as an invalid cookie", () => {
        const request = new Request("https://canvas.example", { headers: { cookie: "canvas_session=%E0%A4%A" } });
        expect(readCookie(request, "canvas_session")).toBe("");
    });

    test("rejects weak passwords for new credentials while allowing a strong password", () => {
        expect(personalPasswordIssue("12345678")).toContain("过于简单");
        expect(personalPasswordIssue("aaaaaaaa")).toContain("过于简单");
        expect(personalPasswordIssue("Moxuan!2026")).toBeNull();
        expect(personalPasswordIssue("short")).toContain("至少 8");
    });
});
