import { Alert, Button, Form, Input } from "antd";
import { ArrowRight, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { requestRegistrationCode } from "@/services/server-api";
import { LoginRealmBackground, RealmWelcomeText } from "@/components/auth/login-realm";

type AccessForm = { displayName: string; accessCode: string; personalCode: string; register?: boolean; email?: string; code?: string };

export default function LoginFormView({ configured, registrationEnabled, error, submitting, submit }: { configured: boolean; registrationEnabled: boolean; error: string; submitting: boolean; submit: (values: AccessForm) => Promise<void> }) {
    const [register, setRegister] = useState(false);
    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [remaining, setRemaining] = useState(0);
    const [mailError, setMailError] = useState("");
    const [mailNotice, setMailNotice] = useState("");
    useEffect(() => {
        if (!remaining) return;
        const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [remaining]);
    const sendCode = async () => {
        setSending(true);
        setMailError("");
        setMailNotice("");
        try { const result = await requestRegistrationCode(email); setRemaining(result.retryAfter); setMailNotice(result.message); }
        catch (reason) { setMailError(reason instanceof Error ? reason.message : "验证码发送失败"); }
        finally { setSending(false); }
    };
    return (
        <LoginRealmBackground>
            <div className="mx-auto grid min-h-dvh w-full max-w-[1180px] items-center gap-10 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_430px] lg:px-10 lg:py-12">
                <section className="hidden max-w-[610px] lg:block" aria-label="无限画布欢迎语">
                    <div className="mb-14 flex items-center gap-3">
                        <span className="size-9 bg-[#c9a86a]" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} aria-hidden="true" />
                        <div>
                            <h1 className="font-brush text-4xl leading-none text-[#f7f4ea]">无限画布</h1>
                            <p className="mt-2 text-xs text-[#8a8a96]">执笔万象，创造无界。</p>
                        </div>
                    </div>
                    <RealmWelcomeText />
                </section>

                <div className="mx-auto w-full max-w-[430px]">
                    <section className="mb-5 lg:hidden" aria-label="无限画布欢迎语">
                        <div className="mb-6 flex items-center gap-3">
                            <span className="size-8 bg-[#c9a86a]" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} aria-hidden="true" />
                            <h1 className="font-brush text-3xl text-[#f7f4ea]">无限画布</h1>
                        </div>
                        <RealmWelcomeText compact />
                    </section>

                    <section className="login-realm-card relative w-full overflow-hidden rounded-lg border border-[rgb(237_237_230/0.14)] bg-[rgb(12_14_20/0.78)] p-6 shadow-[0_28px_90px_rgb(0_0_0/0.46)] backdrop-blur-xl sm:p-8">
                        <div className="mb-6 flex items-start justify-between gap-4 border-b border-[rgb(237_237_230/0.1)] pb-5">
                            <div>
                                <p className="text-xs font-medium text-[#c9a86a]">{register ? "邮箱注册" : configured ? "创作者身份验证" : "初立山门"}</p>
                                <h2 className="font-brush mt-2 text-3xl text-[#f7f4ea]">{register ? "建立身份" : configured ? "入境令" : "立下入境令"}</h2>
                            </div>
                            <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[rgb(201_168_106/0.28)] bg-[rgb(201_168_106/0.08)] text-[#c9a86a]" aria-hidden="true">
                                <ShieldCheck className="size-5" />
                            </span>
                        </div>

                        <p className="mb-6 text-sm leading-6 text-[#9f9eaa]">{register ? "首次注册需验证邮箱，之后使用用户名与密码登录。" : configured ? "验证你的入境令，继续未完成的画卷。" : "首次使用，请设置管理员身份与此方天地的访问口令。"}</p>

                        {error ? <Alert className="login-realm-alert mb-5" type="error" showIcon message={error} /> : null}
                        {register && mailError ? <Alert className="mb-4" type="error" message={mailError} /> : null}
                        {register && mailNotice ? <Alert className="mb-4" type="success" message={mailNotice} /> : null}
                        <Form<AccessForm> key={register ? "register" : "login"} disabled={submitting} className="login-realm-form" layout="vertical" onFinish={(values) => submit({ ...values, register })} initialValues={{ displayName: "" }} requiredMark={false}>
                            {register ? <Form.Item label="邮箱" name="email" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}><Input className="login-realm-input" prefix={<Mail className="size-4 text-[#777984]" />} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" maxLength={254} /></Form.Item> : null}
                            {register ? <Form.Item label="邮箱验证码" required><div className="flex gap-2"><Form.Item name="code" noStyle rules={[{ required: true, pattern: /^\d{6}$/, message: "请输入 6 位验证码" }]}><Input className="login-realm-input min-w-0" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位验证码" /></Form.Item><Button loading={sending} disabled={!email || remaining > 0} onClick={sendCode}>{remaining ? `${remaining} 秒后重发` : "获取验证码"}</Button></div></Form.Item> : null}
                            <Form.Item label="用户名" name="displayName" rules={[{ required: true, min: 2, message: "请输入至少 2 个字符" }]}>
                                <Input className="login-realm-input" prefix={<UserRound className="size-4 text-[#777984]" />} autoComplete="username" maxLength={32} placeholder="例如：小明" />
                            </Form.Item>
                            {!register && !configured ? <Form.Item label="设置访问口令" name="accessCode" rules={[{ required: true, min: 8, message: "口令至少 8 位" }]}>
                                <Input.Password className="login-realm-input" prefix={<KeyRound className="size-4 text-[#777984]" />} autoComplete={configured ? "current-password" : "new-password"} placeholder="至少 8 位" />
                            </Form.Item> : null}
                            <Form.Item label={register ? "设置密码" : configured ? "个人密码（兼容旧账号）" : "设置个人密码"} name="personalCode" rules={[{ required: true, min: register ? 8 : configured ? 6 : 10, message: `个人密码至少 ${register ? 8 : configured ? 6 : 10} 位` }]}>
                                <Input.Password
                                    className="login-realm-input"
                                    prefix={<ShieldCheck className="size-4 text-[#777984]" />}
                                    autoComplete={register || !configured ? "new-password" : "current-password"}
                                    maxLength={128}
                                    placeholder={register ? "至少 8 位" : configured ? "用于进入你的个人账号；新密码至少 8 位" : "管理员个人密码至少 10 位"}
                                />
                            </Form.Item>
                            {register ? <Form.Item label="确认密码" name="confirmPassword" dependencies={["personalCode"]} rules={[{ required: true, message: "请再次输入密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value === getFieldValue("personalCode") ? Promise.resolve() : Promise.reject(new Error("两次密码不一致")); } })]}><Input.Password className="login-realm-input" autoComplete="new-password" maxLength={128} /></Form.Item> : null}
                            <Button className="login-realm-submit mt-1 !h-12" type="primary" htmlType="submit" block size="large" loading={submitting} icon={submitting ? undefined : <ArrowRight className="size-4" />}>
                                {submitting ? "正在叩问天地……" : register ? "完成注册" : configured ? "进入画界" : "完成初始化"}
                            </Button>
                            {configured && registrationEnabled ? <Button type="link" block onClick={() => { setRegister((value) => !value); setEmail(""); setMailError(""); setMailNotice(""); }}>{register ? "已有账号？返回登录" : "首次使用？邮箱注册"}</Button> : null}
                            {configured && !registrationEnabled ? <p className="mt-3 text-center text-xs text-[#9f9eaa]">邮箱注册暂未开放</p> : null}
                        </Form>
                    </section>
                </div>
            </div>
        </LoginRealmBackground>
    );
}
