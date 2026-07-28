import { describe, expect, test } from "bun:test";

import { decryptSecret, encryptSecret, normalizeEncryptionSecret } from "./crypto-store";

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

    test("rejects missing or placeholder production encryption keys", () => {
        expect(normalizeEncryptionSecret(undefined)).toBeUndefined();
        expect(() => normalizeEncryptionSecret(undefined, true)).toThrow("必须设置");
        expect(() => normalizeEncryptionSecret("replace-with-a-long-random-secret", true)).toThrow("不能使用示例值");
        expect(() => normalizeEncryptionSecret("too-short", true)).toThrow("至少 32 位");
        expect(normalizeEncryptionSecret("5Nf6sGmSb4Wv9Hq7cX2eL8rT1uY3kP0a", true)).toBe("5Nf6sGmSb4Wv9Hq7cX2eL8rT1uY3kP0a");
    });
});
