import { afterEach, expect, test } from "bun:test";
import { confirmPasswordReset, requestPasswordResetCode } from "./password-reset-api";
import { ServerRequestError } from "./server-api";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; });

function transport(reply: unknown, status = 200) {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    globalThis.window = { setTimeout, clearTimeout, dispatchEvent: () => true } as unknown as Window & typeof globalThis;
    globalThis.fetch = (async (url, init) => {
        requests.push({ url: String(url), init: init || {} });
        return Response.json(reply, { status });
    }) as typeof fetch;
    return requests;
}

test("requesting a reset posts only the email without account identity or cached responses", async () => {
    const response = { ok: true, message: "若邮箱已绑定账号，请查收验证码", retryAfter: 60 };
    const requests = transport(response);
    expect(await requestPasswordResetCode("member@example.com")).toEqual(response);
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0];
    expect(url).toBe("/api/auth/password-reset-code");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("X-Expected-User-Id")).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual({ email: "member@example.com" });
});

test("confirmation posts the code and new password exactly once, without URL secrets", async () => {
    const requests = transport({ ok: true, message: "密码已重置，请重新登录" });
    const input = { email: "member@example.com", code: "123456", newPassword: "NewPass!2026" };
    expect((await confirmPasswordReset(input)).ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/auth/password-reset");
    expect(requests[0].init.method).toBe("POST");
    expect(new Headers(requests[0].init.headers).get("X-Expected-User-Id")).toBeNull();
    expect(JSON.parse(String(requests[0].init.body))).toEqual(input);
});

test("rate limiting and invalid codes are surfaced with no automatic resend or replay", async () => {
    for (const status of [400, 429]) {
        const requests = transport({ error: { message: "请稍后重试" } }, status);
        try { await confirmPasswordReset({ email: "member@example.com", code: "000000", newPassword: "NewPass!2026" }); throw new Error("expected rejection"); }
        catch (error) { expect(error).toBeInstanceOf(ServerRequestError); expect((error as ServerRequestError).status).toBe(status); }
        expect(requests).toHaveLength(1);
    }
});
