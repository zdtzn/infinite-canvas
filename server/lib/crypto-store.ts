import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type EncryptedSecret = {
    iv: string;
    tag: string;
    data: string;
};

export function encryptSecret(value: string, secret: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
}

export function decryptSecret(value: EncryptedSecret, secret: string) {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(value.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(value.data, "base64url")), decipher.final()]).toString("utf8");
}

export function normalizeEncryptionSecret(value: string | undefined, required = false) {
    const secret = String(value || "").trim();
    if (!secret) {
        if (required) throw new Error("公网部署必须设置 APP_ENCRYPTION_KEY");
        return undefined;
    }
    if (secret.length < 32 || /^(?:replace-with|change-me|example|password|secret)/i.test(secret)) {
        throw new Error("APP_ENCRYPTION_KEY 必须是至少 32 位的随机密钥，不能使用示例值");
    }
    return secret;
}

function encryptionKey(secret: string) {
    return createHash("sha256").update(secret).digest();
}
