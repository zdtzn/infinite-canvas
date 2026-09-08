import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createEmailRegistration, normalizeRegistrationEmail, smtpConfigured } from "./email-registration";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture(send?: (email: string, code: string) => Promise<void>) {
    const db = new Database(":memory:");
    databases.push(db);
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (user_id TEXT PRIMARY KEY); INSERT INTO users VALUES ('a'), ('b')");
    let time = 1_000_000;
    let lastCode = "";
    const service = createEmailRegistration(db, "test-secret", send || (async (_, code) => { lastCode = code; }), () => time);
    return { db, service, code: () => lastCode, advance: (ms: number) => { time += ms; } };
}

describe("email registration", () => {
    test("normalizes email and rejects header injection", () => {
        expect(normalizeRegistrationEmail(" User@GMAIL.com ")).toBe("user@gmail.com");
        for (const value of [null, "bad", "a@b.com\r\nBcc: x@y.com", "a@b.com,evil@b.com", "a".repeat(255) + "@b.com"]) expect(() => normalizeRegistrationEmail(value)).toThrow();
        expect(smtpConfigured({})).toBe(false);
    });
    test("stores only hashed codes, verifies once and binds unique email", async () => {
        const f = fixture();
        await f.service.request("a@example.com", "ip");
        const row = f.db.query("SELECT * FROM registration_codes").get();
        expect(JSON.stringify(row)).not.toContain(f.code());
        f.service.verify("a@example.com", f.code());
        f.db.transaction(() => f.service.bind("a", "a@example.com"))();
        expect(f.service.registered("a@example.com")).toBe(true);
        expect(() => f.service.verify("a@example.com", f.code())).toThrow();
        expect(() => f.service.bind("b", "a@example.com")).toThrow();
    });
    test("locks code after five failures and persists attempts across service recreation", async () => {
        const f = fixture();
        await f.service.request("a@example.com", "ip");
        for (let i = 0; i < 5; i++) expect(() => f.service.verify("a@example.com", "000000")).toThrow();
        const reopened = createEmailRegistration(f.db, "test-secret");
        expect(() => reopened.verify("a@example.com", f.code())).toThrow();
    });
    test("expiry, cooldown and replacement invalidate old codes", async () => {
        const f = fixture();
        await f.service.request("a@example.com", "ip");
        await expect(f.service.request("a@example.com", "ip2")).rejects.toThrow();
        f.advance(600_001);
        expect(() => f.service.verify("a@example.com", f.code())).toThrow();
        await f.service.request("a@example.com", "ip");
        f.service.verify("a@example.com", f.code());
    });
    test("daily budget survives recreation and pending mail cannot be verified", async () => {
        let release!: () => void;
        let code = "";
        const f = fixture(async (_, value) => { code = value; await new Promise<void>((resolve) => { release = resolve; }); });
        const pending = f.service.request("a@example.com", "ip");
        expect(() => f.service.verify("a@example.com", code)).toThrow();
        release(); await pending;
        f.service.verify("a@example.com", code);
        const reopened = createEmailRegistration(f.db, "test-secret", async () => {}, () => 1_000_000);
        await expect(reopened.request("a@example.com", "another-ip")).rejects.toThrow();
    });
    test("SMTP failure leaves no usable code or leaked error", async () => {
        const f = fixture(async () => { throw new Error("secret SMTP credentials"); });
        await expect(f.service.request("a@example.com", "ip")).rejects.toThrow("验证码邮件发送失败");
        expect(f.db.query("SELECT * FROM registration_codes").all()).toHaveLength(0);
    });
    test("transaction failure restores code and does not bind email", async () => {
        const f = fixture();
        await f.service.request("a@example.com", "ip");
        expect(() => f.db.transaction(() => { f.service.bind("a", "a@example.com"); throw new Error("rollback"); })()).toThrow();
        expect(f.service.registered("a@example.com")).toBe(false);
        f.service.verify("a@example.com", f.code());
    });
});
