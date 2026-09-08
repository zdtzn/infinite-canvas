import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Database } from "bun:sqlite";
import nodemailer from "nodemailer";

export function normalizeRegistrationEmail(value: unknown) {
    if (typeof value !== "string") throw new Error("请输入有效邮箱");
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)) throw new Error("请输入有效邮箱");
    return email;
}

export function smtpConfigured(env = process.env) {
    return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
}

export async function sendRegistrationEmail(email: string, code: string) {
    if (!smtpConfigured()) throw new Error("邮件服务尚未配置");
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    try {
        await transport.sendMail({
            from: { name: "无限画布", address: process.env.SMTP_FROM! }, to: email,
            subject: "无限画布注册验证码",
            text: `你的注册验证码为：${code}\n\n10 分钟内有效，请勿向他人透露。\n若非本人操作，请忽略此邮件。`,
        });
    } finally { transport.close(); }
}

// Persist attempts and send budgets so restarting cannot bypass verification limits.
export function createEmailRegistration(db: Database, secret: string, send = sendRegistrationEmail, now = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS registration_codes (
        email_key TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS registration_send_limits (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL, last_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS user_emails (
        user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE, verified_at INTEGER NOT NULL);`);
    const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    function budget(key: string, max: number, cooldown: number, time: number) {
        const row = db.query("SELECT count, reset_at, last_at FROM registration_send_limits WHERE key = ?").get(key) as { count: number; reset_at: number; last_at: number } | null;
        if (row && row.reset_at > time && (row.count >= max || time - row.last_at < cooldown)) throw new Error("验证码发送过于频繁，请稍后再试");
        db.query("INSERT OR REPLACE INTO registration_send_limits VALUES (?, ?, ?, ?)").run(key, row && row.reset_at > time ? row.count + 1 : 1, row && row.reset_at > time ? row.reset_at : time + 86_400_000, time);
    }
    return {
        async request(email: string, ip: string) {
            const time = now();
            const key = digest(`email:${email}`);
            const code = String(randomInt(100000, 1000000));
            const hash = digest(`${email}:${code}`);
            db.transaction(() => {
                db.query("DELETE FROM registration_codes WHERE expires_at <= ?").run(time);
                db.query("DELETE FROM registration_send_limits WHERE reset_at <= ?").run(time);
                budget(key, 6, 60_000, time);
                budget(digest(`ip:${ip}`), 20, 0, time);
                budget("global", 200, 0, time);
                db.query("INSERT OR REPLACE INTO registration_codes VALUES (?, ?, ?, 0, 0)").run(key, hash, time + 600_000);
            })();
            // Do not disclose registered addresses or send unwanted registration mail to them.
            if (db.query("SELECT 1 FROM user_emails WHERE email = ?").get(email)) return;
            try {
                await send(email, code);
                db.query("UPDATE registration_codes SET ready = 1 WHERE email_key = ? AND code_hash = ?").run(key, hash);
            } catch {
                db.query("DELETE FROM registration_codes WHERE email_key = ? AND code_hash = ?").run(key, hash);
                throw new Error("验证码邮件发送失败，请稍后重试或联系管理员");
            }
        },
        verify(email: string, code: unknown) {
            const key = digest(`email:${email}`);
            const row = db.query("SELECT * FROM registration_codes WHERE email_key = ?").get(key) as { code_hash: string; expires_at: number; attempts: number; ready: number } | null;
            if (!row || !row.ready || row.expires_at <= now() || row.attempts >= 5) throw new Error("验证码无效或已过期，请重新获取");
            db.query("UPDATE registration_codes SET attempts = attempts + 1 WHERE email_key = ?").run(key);
            if (typeof code !== "string" || !/^\d{6}$/.test(code) || !timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(digest(`${email}:${code}`), "hex"))) throw new Error("验证码错误");
        },
        bind(userId: string, email: string) {
            db.query("INSERT INTO user_emails VALUES (?, ?, ?)").run(userId, email, now());
            db.query("DELETE FROM registration_codes WHERE email_key = ?").run(digest(`email:${email}`));
        },
        registered(email: string) { return Boolean(db.query("SELECT 1 FROM user_emails WHERE email = ?").get(email)); },
    };
}
