export function passwordResetPasswordIssue(value: unknown) {
    const password = typeof value === "string" ? value.trim() : "";
    if (password.length < 8 || password.length > 128) return "新密码需为 8 到 128 位";
    if (/\p{C}/u.test(password)) return "新密码不能包含控制字符";
    return null;
}

export function passwordResetCooldownDeadline(retryAfter: unknown, now = Date.now()) {
    const seconds = typeof retryAfter === "number" && Number.isFinite(retryAfter) ? Math.min(86_400, Math.max(60, Math.ceil(retryAfter))) : 60;
    return now + seconds * 1000;
}

export function passwordResetCooldownSeconds(deadline: number, now = Date.now()) {
    return Math.max(0, Math.ceil((deadline - now) / 1000));
}
