import { expect, test } from "bun:test";

import { CONTENT_SECURITY_POLICY } from "./security-policy";

test("content security policy permits only loopback HTTP connections for Canvas Agent", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("http://127.0.0.1:*");
    expect(CONTENT_SECURITY_POLICY).toContain("http://localhost:*");
    expect(CONTENT_SECURITY_POLICY).toContain("http://[::1]:*");
    expect(CONTENT_SECURITY_POLICY).not.toContain("connect-src 'self' http:");
    expect(CONTENT_SECURITY_POLICY).not.toContain("192.168.");
});

test("browser inference can load generated wasm modules without weakening inline script protection", () => {
    const scriptPolicy = CONTENT_SECURITY_POLICY.split("; ").find((directive) => directive.startsWith("script-src "));
    expect(scriptPolicy).toContain("blob:");
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
    expect(scriptPolicy).not.toContain("'unsafe-eval'");
});
