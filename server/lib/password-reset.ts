import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { UserRecord } from "../types";
import { hashAccessCode, personalPasswordIssue } from "./auth";
import { ensureEmailVerificationTables, normalizeRegistrationEmail, sendPasswordResetEmail } from "./email-registration";

export const PASSWORD_RESET_NOTICE = "若邮箱已绑定可用账号，重置验证码将发送至该邮箱，请查收或检查垃圾邮件";
export const PASSWORD_RESET_SUCCESS = "密码已重置，所有设备的旧登录状态已失效，请使用新密码登录";
const INVALID_CODE = "验证码无效或已过期，请重新获取";
const DAY = 86_400_000;

export class PasswordResetError extends Error {
    constructor(message: string, public readonly status = 400, public readonly retryAfter?: number) { super(message); }
}

export type PasswordResetInput = { email?: unknown; code?: unknown; newPassword?: unknown };
export type PasswordResetDependencies = {
    getUser: (userId: string) => UserRecord | undefined;
    // Called synchronously inside the code-consumption SQLite transaction. Update loginHash,
    // increment the existing sessionVersion, and writeState(); restore memory on write failure.
    // The route must wrap confirm() in withAuthMutation, like registration/password changes.
    commitPassword: (userId: string, loginHash: string) => void;
    send?: (email: string, code: string) => Promise<void>;
    now?: () => number;
};

export function createPasswordReset(db: Database, secret: string, dependencies: PasswordResetDependencies) {
    ensureEmailVerificationTables(db);
    const now = dependencies.now || Date.now;
    const send = dependencies.send || sendPasswordResetEmail;
    // Reuse the durable verification tables, with purpose-separated keys AND hashes.
    const digest = (value: string) => createHmac("sha256", secret).update(`password-reset:${value}`).digest("hex");
    const emailKey = (email: string) => digest(`email:${email}`);
    const codeHash = (email: string, code: string, user?: UserRecord) => digest(JSON.stringify(["code", email, code, user?.userId, user?.loginHash, user?.sessionVersion || 1]));
    const codeRow = (key: string) => db.query("SELECT * FROM registration_codes WHERE email_key = ?").get(key) as { code_hash: string; expires_at: number; attempts: number; ready: number } | null;
    function normalizeEmail(value: unknown) {
        try { return normalizeRegistrationEmail(value); }
        catch { throw new PasswordResetError("请输入有效邮箱"); }
    }
    function account(email: string) {
        const binding = db.query("SELECT user_id FROM user_emails WHERE email = ?").get(email) as { user_id: string } | null;
        const user = binding ? dependencies.getUser(binding.user_id) : undefined;
        return user?.loginHash && !user.disabled && (!user.status || user.status === "NORMAL") ? user : undefined;
    }
    function budget(key: string, max: number, cooldown: number, time: number, windowMs = DAY) {
        const row = db.query("SELECT count, reset_at, last_at FROM registration_send_limits WHERE key = ?").get(key) as { count: number; reset_at: number; last_at: number } | null;
        if (row && row.reset_at > time && (row.count >= max || time - row.last_at < cooldown)) {
            const retryAfter = Math.max(1, Math.ceil(((row.count >= max ? row.reset_at : row.last_at + cooldown) - time) / 1000));
            throw new PasswordResetError("操作过于频繁，请稍后再试", 429, retryAfter);
        }
        db.query("INSERT OR REPLACE INTO registration_send_limits VALUES (?, ?, ?, ?)").run(key, row && row.reset_at > time ? row.count + 1 : 1, row && row.reset_at > time ? row.reset_at : time + windowMs, time);
    }
    async function deliver(email: string, code: string, key: string, hash: string, requestId: string) {
        let stage: "smtp" | "activate_code" = "smtp";
        try {
            await send(email, code);
            stage = "activate_code";
            db.query("UPDATE registration_codes SET ready = 1 WHERE email_key = ? AND code_hash = ? AND ready = 0").run(key, hash);
        } catch {
            // Allowlist fixed fields only: SMTP/DB errors can contain recipients, codes or secrets.
            // Log before cleanup so cleanup failure cannot hide the delivery failure.
            console.warn(JSON.stringify({ event: "password_reset_mail_failed", entryPoint: "password_reset_code", requestId, stage }));
            db.query("DELETE FROM registration_codes WHERE email_key = ? AND code_hash = ?").run(key, hash);
        }
    }

    return {
        async request(value: unknown, ip: string, requestId?: string) {
            const email = normalizeEmail(value);
            // Optional server-generated HTTP request ID; never reflect arbitrary header/body text.
            const correlationId = typeof requestId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId) ? requestId : randomUUID();
            const time = now();
            const key = emailKey(email);
            const code = String(randomInt(100000, 1000000));
            let user: UserRecord | undefined;
            let hash = "";
            db.transaction(() => {
                db.query("DELETE FROM registration_codes WHERE expires_at <= ?").run(time);
                db.query("DELETE FROM registration_send_limits WHERE reset_at <= ?").run(time);
                budget(digest(`send-email:${email}`), 6, 60_000, time);
                budget(digest(`send-ip:${ip}`), 20, 0, time);
                budget(digest("send-global"), 200, 0, time);
                user = account(email);
                hash = codeHash(email, code, user);
                db.query("INSERT OR REPLACE INTO registration_codes VALUES (?, ?, ?, 0, 0)").run(key, hash, time + 600_000);
            })();
            // Never await SMTP in the public response: unknown/disabled addresses and SMTP
            // failures receive the same response without a delivery-time enumeration oracle.
            if (user) void Promise.resolve().then(() => deliver(email, code, key, hash, correlationId)).catch(() => undefined);
            return { ok: true as const, message: PASSWORD_RESET_NOTICE, retryAfter: 60 };
        },
        async confirm(input: PasswordResetInput, ip: string) {
            // The IP budget is committed even for invalid inputs/codes.
            db.transaction(() => budget(digest(`verify-ip:${ip}`), 30, 0, now(), 900_000))();
            if (!input || typeof input !== "object" || Array.isArray(input)) throw new PasswordResetError("请求格式无效");
            const email = normalizeEmail(input.email);
            const password = typeof input.newPassword === "string" ? input.newPassword.trim() : "";
            const issue = personalPasswordIssue(password, 8);
            if (issue) throw new PasswordResetError(issue);
            const key = emailKey(email);
            const claim = db.transaction(() => {
                const row = codeRow(key);
                if (!row || row.ready !== 1 || row.expires_at <= now() || row.attempts >= 5) return null;
                // Return failures from the transaction so the attempt count is not rolled back.
                db.query("UPDATE registration_codes SET attempts = attempts + 1 WHERE email_key = ?").run(key);
                const user = account(email);
                if (!user || typeof input.code !== "string" || !/^\d{6}$/.test(input.code)
                    || !timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(codeHash(email, input.code, user), "hex"))) return null;
                // Claim before asynchronous scrypt so simultaneous submissions cannot reuse a code.
                db.query("UPDATE registration_codes SET ready = 2 WHERE email_key = ?").run(key);
                return { userId: user.userId, hash: row.code_hash };
            })();
            if (!claim) throw new PasswordResetError(INVALID_CODE);
            try {
                const loginHash = await hashAccessCode(password);
                db.transaction(() => {
                    const row = codeRow(key);
                    const user = account(email);
                    if (!row || row.ready !== 2 || row.code_hash !== claim.hash || row.expires_at <= now()
                        || !user || codeHash(email, input.code as string, user) !== claim.hash) throw new PasswordResetError(INVALID_CODE);
                    db.query("DELETE FROM registration_codes WHERE email_key = ? AND code_hash = ?").run(key, claim.hash);
                    dependencies.commitPassword(claim.userId, loginHash);
                })();
            } catch (error) {
                db.query("UPDATE registration_codes SET ready = 1 WHERE email_key = ? AND code_hash = ? AND ready = 2").run(key, claim.hash);
                if (error instanceof PasswordResetError) throw error;
                throw new PasswordResetError("暂时无法重置密码，请稍后重试", 503);
            }
            return { ok: true as const, message: PASSWORD_RESET_SUCCESS };
        },
    };
}
