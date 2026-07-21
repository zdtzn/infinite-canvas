import { describe, expect, test } from "bun:test";

import { decryptSecret, encryptSecret } from "./crypto-store";

describe("encrypted credential storage", () => {
    test("round-trips provider keys without leaving plaintext in persisted JSON", () => {
        const encrypted = encryptSecret("sk-sensitive-value", "server-secret");
        expect(JSON.stringify(encrypted)).not.toContain("sk-sensitive-value");
        expect(decryptSecret(encrypted, "server-secret")).toBe("sk-sensitive-value");
    });

    test("rejects ciphertext modified after persistence", () => {
        const encrypted = encryptSecret("sk-value", "server-secret");
        expect(() => decryptSecret({ ...encrypted, data: `${encrypted.data}x` }, "server-secret")).toThrow();
    });
});
