import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export type SessionPayload = {
    userId: string;
    displayName: string;
    admin?: boolean;
};

export async function hashAccessCode(value: string) {
    const salt = randomBytes(16);
    const derived = (await scrypt(value, salt, 32)) as Buffer;
    return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyAccessCode(value: string, encoded: string) {
    const [algorithm, saltValue, hashValue] = encoded.split("$");
    if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, "base64url");
    const actual = (await scrypt(value, Buffer.from(saltValue, "base64url"), expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken(payload: SessionPayload, secret: string, ttlMs = 1000 * 60 * 60 * 24 * 14, now = Date.now()) {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs })).toString("base64url");
    return `${body}.${sign(body, secret)}`;
}

export function readSessionToken(token: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
    if (!token) return null;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;
    const expected = Buffer.from(sign(body, secret));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload & { exp?: number };
        if (!payload.userId || !payload.displayName || !payload.exp || payload.exp <= now) return null;
        return { userId: payload.userId, displayName: payload.displayName, admin: payload.admin };
    } catch {
        return null;
    }
}

export function createIdentityToken(userId: string, secret: string, ttlMs = 1000 * 60 * 60 * 24 * 365, now = Date.now()) {
    const body = Buffer.from(JSON.stringify({ userId, purpose: "device-identity", exp: now + ttlMs })).toString("base64url");
    return `${body}.${sign(body, secret)}`;
}

export function readIdentityToken(token: string | undefined, secret: string, now = Date.now()) {
    if (!token) return null;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;
    const expected = Buffer.from(sign(body, secret));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { userId?: string; purpose?: string; exp?: number };
        if (!payload.userId || payload.purpose !== "device-identity" || !payload.exp || payload.exp <= now) return null;
        return payload.userId;
    } catch {
        return null;
    }
}

export function readCookie(request: Request, name: string) {
    const cookie = request.headers.get("cookie") || "";
    for (const entry of cookie.split(";")) {
        const [key, ...parts] = entry.trim().split("=");
        if (key === name) return decodeURIComponent(parts.join("="));
    }
    return "";
}

export function sessionCookie(token: string, secure: boolean) {
    return `canvas_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(secure: boolean) {
    return `canvas_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function identityCookie(token: string, secure: boolean) {
    return `canvas_identity=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}`;
}

export function expiredIdentityCookie(secure: boolean) {
    return `canvas_identity=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function sign(value: string, secret: string) {
    return createHmac("sha256", secret).update(value).digest("base64url");
}
