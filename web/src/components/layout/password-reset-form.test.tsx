import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LoginFormView from "./login-form";
import { PasswordResetForm } from "./password-reset-form";
import { passwordResetCooldownDeadline, passwordResetCooldownSeconds, passwordResetPasswordIssue } from "./password-reset-form-helpers";

test("forgot-password entry is available even when registration is closed, only when configured", () => {
    const props = { configured: true, registrationEnabled: false, passwordResetEnabled: true, error: "", submitting: false, submit: async () => {} };
    expect(renderToStaticMarkup(createElement(LoginFormView, props))).toContain("忘记密码？");
    expect(renderToStaticMarkup(createElement(LoginFormView, { ...props, passwordResetEnabled: false }))).not.toContain("忘记密码？");
    expect(renderToStaticMarkup(createElement(LoginFormView, { ...props, configured: false }))).not.toContain("忘记密码？");
});

test("reset form presents email, OTP, new password confirmation and an explicit login return", () => {
    const html = renderToStaticMarkup(createElement(PasswordResetForm, { onBack: () => {}, onSuccess: () => {} }));
    for (const text of ["注册邮箱", "邮箱验证码", "新密码", "确认新密码", "获取验证码", "重置密码", "返回登录", "未绑定邮箱的旧账号请联系管理员"]) expect(html).toContain(text);
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html).not.toContain('autoComplete="current-password"');
});

test("resend cooldown uses wall-clock time and safely handles invalid server values", () => {
    const deadline = passwordResetCooldownDeadline(60, 1000);
    expect(passwordResetCooldownSeconds(deadline, 1000)).toBe(60);
    expect(passwordResetCooldownSeconds(deadline, 1550)).toBe(60);
    expect(passwordResetCooldownSeconds(deadline, 60_999)).toBe(1);
    expect(passwordResetCooldownSeconds(deadline, 61_000)).toBe(0);
    expect(passwordResetCooldownSeconds(deadline, 900_000)).toBe(0);
    for (const value of [undefined, null, -3, 0, NaN, Infinity, "120"]) expect(passwordResetCooldownDeadline(value, 0)).toBe(60_000);
    expect(passwordResetCooldownDeadline(120, 0)).toBe(120_000);
});

test("client rejects empty, too long and control-character passwords and follows server trimming", () => {
    for (const value of [undefined, "short", "   abcde   ", "a".repeat(129), "pass\u0000word123"]) expect(passwordResetPasswordIssue(value)).not.toBeNull();
    expect(passwordResetPasswordIssue(" NewPass!2026 ")).toBeNull();
});
