import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHmac } from "node:crypto";
import type { UserRecord } from "../types";
import { createSessionToken, hashAccessCode, readSessionToken, verifyAccessCode } from "./auth";
import { createEmailRegistration } from "./email-registration";
import { createPasswordReset, PASSWORD_RESET_NOTICE, PASSWORD_RESET_SUCCESS, PasswordResetError, type PasswordResetInput } from "./password-reset";

const resources: Array<() => void> = [];
afterEach(() => { for (const cleanup of resources.splice(0).reverse()) cleanup(); });
const initialHash = await hashAccessCode("OldPass!2026");
const email = "member@example.com";
const secret = "test-only-reset-secret";
const newPassword = "NewPass!2026";

function fixture(options: { send?: (email: string, code: string) => Promise<void> } = {}) {
    let db = new Database(":memory:");
    resources.push(() => db.close());
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (user_id TEXT PRIMARY KEY, login_hash TEXT, session_version INTEGER)");
    db.query("INSERT INTO users VALUES ('a', ?, 3), ('b', ?, 1)").run(initialHash, initialHash);
    const users: Record<string, UserRecord> = {
        a: { userId: "a", displayName: "测试成员", createdAt: 1, loginHash: initialHash, sessionVersion: 3, status: "NORMAL" },
        b: { userId: "b", displayName: "另一个成员", createdAt: 1, loginHash: initialHash, sessionVersion: 1, status: "NORMAL" },
    };
    let time = 1_000_000;
    let failCommit = false;
    let commits = 0;
    const messages: Array<{ email: string; code: string }> = [];
    const send = async (address: string, code: string) => { messages.push({ email: address, code }); await options.send?.(address, code); };
    const dependencies = {
        getUser: (id: string) => users[id], now: () => time, send,
        commitPassword(id: string, hash: string) {
            const user = users[id];
            const old = { ...user };
            user.loginHash = hash;
            user.sessionVersion = (user.sessionVersion || 1) + 1;
            try {
                db.query("UPDATE users SET login_hash = ?, session_version = ? WHERE user_id = ?").run(hash, user.sessionVersion, id);
                if (failCommit) throw new Error("private database path / secret");
                commits++;
            } catch (error) { users[id] = old; throw error; }
        },
    };
    const service = createPasswordReset(db, secret, dependencies);
    db.query("INSERT INTO user_emails VALUES ('a', ?, 1)").run(email);
    const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
    return {
        db, users, service, dependencies, messages, flush,
        code: () => messages.at(-1)!.code,
        advance: (ms: number) => { time += ms; },
        setFailCommit: (value: boolean) => { failCommit = value; },
        commits: () => commits,
        async request(address = email, ip = "ip", requestId?: string) { const result = await service.request(address, ip, requestId); await flush(); return result; },
        confirm(code = messages.at(-1)?.code, ip = "ip", password: unknown = newPassword, address = email) { return service.confirm({ email: address, code, newPassword: password }, ip); },
        reopen() {
            const snapshot = db.serialize();
            db.close();
            db = Database.deserialize(snapshot);
            return createPasswordReset(db, secret, dependencies);
        },
    };
}

describe("password reset", () => {
    test("normalizes email; stores only purpose-bound hashes and applies existing password/session policies", async () => {
        const f = fixture();
        const token = createSessionToken({ userId: "a", displayName: "测试成员", sessionVersion: 3 }, secret);
        expect(await f.request(" Member@Example.COM ")).toEqual({ ok: true, message: PASSWORD_RESET_NOTICE, retryAfter: 60 });
        expect(f.messages[0].email).toBe(email);
        expect(f.code()).toMatch(/^[1-9]\d{5}$/);
        const row = f.db.query("SELECT * FROM registration_codes").get();
        expect(JSON.stringify(row)).not.toContain(f.code());
        expect(JSON.stringify(row)).not.toContain(email);
        expect(await f.confirm()).toEqual({ ok: true, message: PASSWORD_RESET_SUCCESS });
        expect(await verifyAccessCode(newPassword, f.users.a.loginHash!)).toBe(true);
        expect(await verifyAccessCode("OldPass!2026", f.users.a.loginHash!)).toBe(false);
        expect(f.users.a.sessionVersion).toBe(4);
        expect(readSessionToken(token, secret)!.sessionVersion).not.toBe(f.users.a.sessionVersion);
        expect(f.db.query("SELECT session_version FROM users WHERE user_id = 'a'").get()).toEqual({ session_version: 4 });
        expect(f.db.query("SELECT * FROM registration_codes").all()).toHaveLength(0);
        await expect(f.confirm()).rejects.toThrow("验证码无效或已过期");
    });

    test("unknown, disabled, banned and passwordless accounts get identical responses without mail", async () => {
        const f = fixture();
        const expected = await f.request();
        expect(await f.request("unknown@example.com")).toEqual(expected);
        for (const changes of [{ disabled: true }, { disabled: false, status: "BANNED" as const }, { status: "NORMAL" as const, loginHash: undefined }]) {
            Object.assign(f.users.a, changes);
            f.advance(60_000);
            expect(await f.request()).toEqual(expected);
        }
        expect(f.messages).toHaveLength(1);
        await expect(f.confirm()).rejects.toThrow("验证码无效或已过期");
        await expect(f.confirm("000000", "ip", newPassword, "unknown@example.com")).rejects.toThrow("验证码无效或已过期");
    });

    test("public request completes before mail delivery; pending codes cannot be used", async () => {
        let release!: () => void;
        const f = fixture({ send: () => new Promise<void>((resolve) => { release = resolve; }) });
        const known = await f.request();
        const unknown = await f.request("unknown@example.com");
        expect(known).toEqual(unknown);
        await expect(f.confirm()).rejects.toThrow("验证码无效或已过期");
        release(); await f.flush();
        expect((await f.confirm()).ok).toBe(true);
    });

    test("SMTP failures leave no usable code and never disclose account existence or transport errors", async () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        resources.push(() => warn.mockRestore());
        const requestId = "f1bb311a-aaa6-44ac-8a2e-ed70fbbf177a";
        const f = fixture({ send: async (address, code) => { throw Object.assign(new Error(`${address} ${code} SMTP password/private host`), { code: secret }); } });
        expect(await f.request(email, "ip", requestId)).toEqual(await f.request("unknown@example.com"));
        expect(warn.mock.calls).toEqual([[JSON.stringify({ event: "password_reset_mail_failed", entryPoint: "password_reset_code", requestId, stage: "smtp" })]]);
        const log = String(warn.mock.calls[0][0]);
        for (const sensitive of [email, f.code(), secret, "SMTP password", "private host"]) expect(log).not.toContain(sensitive);
        const key = createHmac("sha256", secret).update(`password-reset:email:${email}`).digest("hex");
        expect(f.db.query("SELECT * FROM registration_codes WHERE email_key = ?").get(key)).toBeNull();
        await expect(f.confirm()).rejects.toThrow("验证码无效或已过期");
        f.advance(60_000);
        await f.request(email, "ip", `untrusted ${email} ${secret}`);
        const fallback = JSON.parse(String(warn.mock.calls[1][0]));
        expect(fallback.requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(Object.keys(fallback).sort()).toEqual(["entryPoint", "event", "requestId", "stage"]);
        expect(JSON.stringify(fallback)).not.toContain(email);
        expect(JSON.stringify(fallback)).not.toContain(secret);
    });

    test("successful mail and unknown/disabled accounts do not emit failure telemetry", async () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        resources.push(() => warn.mockRestore());
        const f = fixture();
        await f.request();
        await f.request("unknown@example.com");
        f.users.a.disabled = true;
        f.advance(60_000);
        await f.request();
        expect(warn).not.toHaveBeenCalled();
    });

    test("code activation failure emits a sanitized stage before cleanup and keeps the generic response", async () => {
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        resources.push(() => warn.mockRestore());
        const f = fixture();
        f.db.exec("CREATE TRIGGER reject_reset_activation BEFORE UPDATE OF ready ON registration_codes WHEN NEW.ready = 1 BEGIN SELECT RAISE(ABORT, 'sensitive database error'); END");
        expect((await f.request()).message).toBe(PASSWORD_RESET_NOTICE);
        expect(warn).toHaveBeenCalledTimes(1);
        const event = JSON.parse(String(warn.mock.calls[0][0]));
        expect(event).toEqual({ event: "password_reset_mail_failed", entryPoint: "password_reset_code", requestId: expect.any(String), stage: "activate_code" });
        expect(f.db.query("SELECT * FROM registration_codes").all()).toHaveLength(0);
        await expect(f.confirm()).rejects.toThrow("验证码无效或已过期");
    });

    test("five malformed/wrong attempts lock the code even across SQLite reopen", async () => {
        const f = fixture();
        await f.request();
        for (const code of ["000000", "bad", 123456, null, "000000"]) {
            await expect(f.service.confirm({ email, code, newPassword }, "ip")).rejects.toThrow("验证码无效或已过期");
        }
        const reopened = f.reopen();
        await expect(reopened.confirm({ email, code: f.code(), newPassword }, "new-ip")).rejects.toThrow("验证码无效或已过期");
        await expect(reopened.request(email, "new-ip")).rejects.toBeInstanceOf(PasswordResetError);
        expect(f.users.a.loginHash).toBe(initialHash);
    });

    test("the fifth attempt can succeed; a sixth attempt cannot", async () => {
        const f = fixture();
        await f.request();
        for (let i = 0; i < 4; i++) await expect(f.confirm("000000")).rejects.toThrow();
        expect((await f.confirm()).ok).toBe(true);
        expect(f.commits()).toBe(1);
    });

    test("expiry and resending invalidate old codes", async () => {
        const f = fixture();
        await f.request();
        const original = f.code();
        f.advance(600_000);
        await expect(f.confirm(original)).rejects.toThrow("验证码无效或已过期");
        await f.request();
        const current = f.code();
        if (current !== original) await expect(f.confirm(original)).rejects.toThrow("验证码无效或已过期");
        expect((await f.confirm(current)).ok).toBe(true);
    });

    test("email cooldown and daily budget apply equally to known and unknown emails", async () => {
        const f = fixture();
        for (const address of [email, "unknown@example.com"]) {
            await f.request(address);
            try { await f.request(address, "different-ip"); throw new Error("expected limit"); }
            catch (error) { expect(error).toMatchObject({ status: 429, retryAfter: 60 }); }
            for (let i = 1; i < 6; i++) { f.advance(60_000); await f.request(address, `ip-${i}`); }
            f.advance(60_000);
            await expect(f.request(address, "fresh-ip")).rejects.toBeInstanceOf(PasswordResetError);
        }
        f.advance(86_400_000);
        expect((await f.request()).ok).toBe(true);
    });

    test("IP and global send limits survive service recreation and limit unknown email floods", async () => {
        const f = fixture();
        for (let i = 0; i < 20; i++) await f.request(`unknown${i}@example.com`, "shared-ip");
        const reopened = createPasswordReset(f.db, secret, f.dependencies);
        await expect(reopened.request("next@example.com", "shared-ip")).rejects.toMatchObject({ status: 429 });
        for (let i = 20; i < 200; i++) await f.request(`unknown${i}@example.com`, `ip-${i}`);
        await expect(reopened.request("last@example.com", "fresh-ip")).rejects.toMatchObject({ status: 429 });
        expect(f.messages).toHaveLength(0);
    });

    test("confirmation IP budget persists even on malformed inputs and across recreation", async () => {
        const f = fixture();
        for (let i = 0; i < 30; i++) await expect(f.service.confirm({}, "ip")).rejects.toThrow("请输入有效邮箱");
        const reopened = createPasswordReset(f.db, secret, f.dependencies);
        await expect(reopened.confirm({}, "ip")).rejects.toMatchObject({ status: 429, retryAfter: 900 });
        f.advance(900_000);
        await expect(reopened.confirm({}, "ip")).rejects.toThrow("请输入有效邮箱");
    });

    test("invalid email and weak passwords never update credentials or consume the code", async () => {
        const f = fixture();
        for (const value of [null, "bad", [], 123]) {
            await expect(f.service.confirm(value as unknown as PasswordResetInput, "ip")).rejects.toThrow("请求格式无效");
        }
        for (const invalid of [null, "bad", "a@b.com\r\nBcc: evil@b.com", "a".repeat(255) + "@b.com"]) {
            await expect(f.service.request(invalid, "ip")).rejects.toThrow("请输入有效邮箱");
        }
        await f.request();
        for (const password of [null, {}, "short", "12345678", "aaaaaaaa", "pass\u0000word123", "x".repeat(129)]) {
            await expect(f.confirm(f.code(), "ip", password)).rejects.toBeInstanceOf(PasswordResetError);
        }
        expect(f.commits()).toBe(0);
        expect((await f.confirm(f.code(), "ip", ` ${newPassword} `)).ok).toBe(true);
        expect(await verifyAccessCode(newPassword, f.users.a.loginHash!)).toBe(true);
    });

    test("registration codes and reset codes cannot cross verification purposes", async () => {
        const f = fixture();
        let registrationCode = "";
        f.db.query("DELETE FROM user_emails WHERE user_id = 'a'").run();
        const registration = createEmailRegistration(f.db, secret, async (_, code) => { registrationCode = code; }, f.dependencies.now);
        await registration.request(email, "ip");
        f.db.query("INSERT INTO user_emails VALUES ('a', ?, 1)").run(email);
        await expect(f.confirm(registrationCode)).rejects.toThrow();
        await f.request();
        const resetHash = (f.db.query("SELECT code_hash FROM registration_codes WHERE ready = 1 AND code_hash <> ?").get(createHmac("sha256", secret).update(`${email}:${registrationCode}`).digest("hex")) as { code_hash: string }).code_hash;
        const registrationHashForResetCode = createHmac("sha256", secret).update(`${email}:${f.code()}`).digest("hex");
        expect(resetHash).not.toBe(registrationHashForResetCode);
        if (registrationCode !== f.code()) {
            await expect(f.confirm(registrationCode)).rejects.toThrow();
            expect(() => registration.verify(email, f.code())).toThrow();
        }
        await f.confirm();
        // Reset consumes only its own row; it never binds/deletes registration challenges.
        registration.verify(email, registrationCode);
    });

    test("code is bound to the account and current credentials, including session revocation", async () => {
        const f = fixture();
        await f.request();
        const code = f.code();
        f.users.a.sessionVersion = 4;
        await expect(f.confirm(code)).rejects.toThrow();
        f.users.a.sessionVersion = 3;
        f.users.a.loginHash = "changed-password-hash";
        await expect(f.confirm(code)).rejects.toThrow();
        f.users.a.loginHash = initialHash;
        f.db.query("UPDATE user_emails SET user_id = 'b' WHERE email = ?").run(email);
        await expect(f.confirm(code)).rejects.toThrow();
        expect(f.commits()).toBe(0);
    });

    test("disabling an account after sending prevents reset", async () => {
        const f = fixture();
        await f.request();
        f.users.a.status = "DISABLED";
        await expect(f.confirm()).rejects.toThrow();
        expect(f.commits()).toBe(0);
    });

    test("simultaneous confirmations consume one code and change the password only once", async () => {
        const f = fixture();
        await f.request();
        const results = await Promise.allSettled([f.confirm(), f.confirm()]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(f.commits()).toBe(1);
        expect(f.users.a.sessionVersion).toBe(4);
    });

    test("a replaced code during password hashing cannot reset the account or consume the newer code", async () => {
        const f = fixture();
        await f.request();
        const pending = f.confirm();
        const checked = pending.then(() => null, (error: unknown) => error);
        f.advance(60_000);
        await f.request();
        expect(await checked).toMatchObject({ message: "验证码无效或已过期，请重新获取" });
        expect(f.commits()).toBe(0);
        expect((await f.confirm()).ok).toBe(true);
    });

    test("late delivery or failure of an older email cannot activate or delete its replacement", async () => {
        const deliveries: Array<{ resolve: () => void; reject: () => void }> = [];
        const f = fixture({ send: () => new Promise<void>((resolve, reject) => deliveries.push({ resolve, reject: () => reject(new Error("SMTP failure")) })) });
        await f.request();
        f.advance(60_000); await f.request();
        deliveries[0].resolve(); await f.flush();
        await expect(f.confirm()).rejects.toThrow();
        f.advance(60_000); await f.request();
        deliveries[1].reject(); await f.flush();
        deliveries[2].resolve(); await f.flush();
        expect((await f.confirm()).ok).toBe(true);
    });

    test("credential persistence failure rolls back SQLite and permits retry without leaking details", async () => {
        const f = fixture();
        await f.request();
        f.setFailCommit(true);
        await expect(f.confirm()).rejects.toMatchObject({ status: 503, message: "暂时无法重置密码，请稍后重试" });
        expect(f.users.a.loginHash).toBe(initialHash);
        expect(f.users.a.sessionVersion).toBe(3);
        expect(f.db.query("SELECT login_hash, session_version FROM users WHERE user_id = 'a'").get()).toEqual({ login_hash: initialHash, session_version: 3 });
        f.setFailCommit(false);
        expect((await f.confirm()).ok).toBe(true);
    });
});
