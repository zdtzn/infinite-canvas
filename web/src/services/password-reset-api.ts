import { serverRequest } from "./server-api";

export type PasswordResetResult = { ok: true; message: string };
export type PasswordResetSubmission = { email: string; code: string; newPassword: string };

export function requestPasswordResetCode(email: string) {
    return serverRequest<PasswordResetResult & { retryAfter: number }>("/api/auth/password-reset-code", {
        method: "POST", body: { email }, expectedUserId: "", cache: "no-store", timeoutMs: 15_000,
    });
}

export function confirmPasswordReset(input: PasswordResetSubmission) {
    return serverRequest<PasswordResetResult>("/api/auth/password-reset", {
        method: "POST", body: input, expectedUserId: "", cache: "no-store", timeoutMs: 30_000,
    });
}
