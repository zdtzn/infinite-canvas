import { Alert, Button, Form, Input } from "antd";
import { KeyRound, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confirmPasswordReset, requestPasswordResetCode, type PasswordResetSubmission } from "@/services/password-reset-api";
import { ServerRequestError } from "@/services/server-api";
import { passwordResetCooldownDeadline, passwordResetCooldownSeconds, passwordResetPasswordIssue } from "./password-reset-form-helpers";

type ResetForm = PasswordResetSubmission & { confirmPassword: string };

export function PasswordResetForm({ onBack, onSuccess }: { onBack: () => void; onSuccess: (message: string) => void }) {
    const [form] = Form.useForm<ResetForm>();
    const [sending, setSending] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [deadline, setDeadline] = useState(0);
    const [remaining, setRemaining] = useState(0);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const busy = useRef(false);
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);
    useEffect(() => {
        const update = () => setRemaining(passwordResetCooldownSeconds(deadline));
        update();
        if (!passwordResetCooldownSeconds(deadline)) return;
        const timer = window.setInterval(() => {
            update();
            if (!passwordResetCooldownSeconds(deadline)) window.clearInterval(timer);
        }, 500);
        return () => window.clearInterval(timer);
    }, [deadline]);
    const startCooldown = (retryAfter: unknown) => {
        const next = passwordResetCooldownDeadline(retryAfter);
        setDeadline(next);
        setRemaining(passwordResetCooldownSeconds(next));
    };
    const sendCode = async () => {
        if (busy.current || passwordResetCooldownSeconds(deadline)) return;
        busy.current = true;
        let email: string;
        try { email = (await form.validateFields(["email"])).email; }
        catch { busy.current = false; return; }
        if (!active.current) { busy.current = false; return; }
        setSending(true);
        setError("");
        setNotice("");
        try {
            const result = await requestPasswordResetCode(email);
            if (!active.current) return;
            startCooldown(result.retryAfter);
            setNotice(result.message);
            form.setFieldValue("code", "");
        } catch (reason) {
            if (!active.current) return;
            if (reason instanceof ServerRequestError && reason.status === 429) startCooldown(60);
            setError(reason instanceof Error ? reason.message : "暂时无法请求验证码，请稍后重试");
        } finally {
            busy.current = false;
            if (active.current) setSending(false);
        }
    };
    const submit = async ({ email, code, newPassword }: ResetForm) => {
        if (busy.current) return;
        busy.current = true;
        setSubmitting(true);
        setError("");
        try {
            const result = await confirmPasswordReset({ email, code, newPassword });
            if (!active.current) return;
            form.resetFields();
            onSuccess(result.message);
        } catch (reason) {
            if (active.current) setError(reason instanceof Error ? reason.message : "密码重置失败，请稍后重试");
        } finally {
            busy.current = false;
            if (active.current) setSubmitting(false);
        }
    };
    return <>
        <p className="mb-5 text-sm leading-6 text-[#9f9eaa]">使用注册时验证的邮箱找回密码。验证码 10 分钟内有效；未绑定邮箱的旧账号请联系管理员。</p>
        {error ? <Alert className="login-realm-alert mb-4" type="error" showIcon title={error} /> : null}
        {notice ? <Alert className="login-realm-alert mb-4" type="info" showIcon title={notice} /> : null}
        <Form<ResetForm> form={form} disabled={sending || submitting} className="login-realm-form" layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item label="注册邮箱" name="email" rules={[{ required: true, type: "email", transform: (value) => typeof value === "string" ? value.trim() : value, message: "请输入有效邮箱" }]}>
                <Input className="login-realm-input" prefix={<Mail className="size-4 text-[#777984]" />} type="email" autoComplete="email" maxLength={254} onChange={() => { setNotice(""); form.setFieldValue("code", ""); }} />
            </Form.Item>
            <Form.Item label="邮箱验证码" required>
                <div className="flex gap-2">
                    <Form.Item name="code" noStyle rules={[{ required: true, pattern: /^\d{6}$/, message: "请输入 6 位验证码" }]}>
                        <Input aria-label="邮箱验证码" className="login-realm-input min-w-0" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位验证码" />
                    </Form.Item>
                    <Button loading={sending} disabled={sending || submitting || remaining > 0} onClick={sendCode}>{remaining ? `${remaining} 秒后重发` : "获取验证码"}</Button>
                </div>
            </Form.Item>
            <Form.Item label="新密码" name="newPassword" extra="8–128 位，避免常见密码、重复字符与连续数字" rules={[{ validator: (_, value) => { const issue = passwordResetPasswordIssue(value); return issue ? Promise.reject(new Error(issue)) : Promise.resolve(); } }]}>
                <Input.Password className="login-realm-input" prefix={<KeyRound className="size-4 text-[#777984]" />} autoComplete="new-password" maxLength={128} placeholder="设置新密码" />
            </Form.Item>
            <Form.Item label="确认新密码" name="confirmPassword" dependencies={["newPassword"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("两次密码不一致")) })]}>
                <Input.Password className="login-realm-input" autoComplete="new-password" maxLength={128} />
            </Form.Item>
            <Button className="login-realm-submit mt-1 !h-12" type="primary" htmlType="submit" block size="large" loading={submitting}>重置密码</Button>
            <Button type="link" block onClick={onBack}>返回登录</Button>
        </Form>
    </>;
}
