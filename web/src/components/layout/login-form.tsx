import { Alert, Button, Form, Input } from "antd";
import { ArrowRight, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { LoginRealmBackground, RealmWelcomeText } from "@/components/auth/login-realm";

type AccessForm = { displayName: string; accessCode: string; personalCode: string };

export default function LoginFormView({ configured, error, submitting, submit }: { configured: boolean; error: string; submitting: boolean; submit: (values: AccessForm) => Promise<void> }) {
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
                                <p className="text-xs font-medium text-[#c9a86a]">{configured ? "创作者身份验证" : "初立山门"}</p>
                                <h2 className="font-brush mt-2 text-3xl text-[#f7f4ea]">{configured ? "入境令" : "立下入境令"}</h2>
                            </div>
                            <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[rgb(201_168_106/0.28)] bg-[rgb(201_168_106/0.08)] text-[#c9a86a]" aria-hidden="true">
                                <ShieldCheck className="size-5" />
                            </span>
                        </div>

                        <p className="mb-6 text-sm leading-6 text-[#9f9eaa]">{configured ? "验证你的入境令，继续未完成的画卷。" : "首次使用，请设置管理员身份与此方天地的访问口令。"}</p>

                        {error ? <Alert className="login-realm-alert mb-5" type="error" showIcon message={error} /> : null}
                        <Form<AccessForm> className="login-realm-form" layout="vertical" onFinish={submit} initialValues={{ displayName: "" }} requiredMark={false}>
                            <Form.Item label="你的昵称" name="displayName" rules={[{ required: true, min: 2, message: "请输入至少 2 个字符" }]}>
                                <Input className="login-realm-input" prefix={<UserRound className="size-4 text-[#777984]" />} autoComplete="nickname" maxLength={32} placeholder="例如：小明" />
                            </Form.Item>
                            <Form.Item label={configured ? "访问口令" : "设置访问口令"} name="accessCode" rules={[{ required: true, min: 8, message: "口令至少 8 位" }]}>
                                <Input.Password className="login-realm-input" prefix={<KeyRound className="size-4 text-[#777984]" />} autoComplete={configured ? "current-password" : "new-password"} placeholder="至少 8 位" />
                            </Form.Item>
                            <Form.Item label={configured ? "个人密码（兼容旧账号）" : "设置个人密码"} name="personalCode" rules={[{ required: true, min: configured ? 6 : 10, message: `个人密码至少 ${configured ? 6 : 10} 位` }]}>
                                <Input.Password
                                    className="login-realm-input"
                                    prefix={<ShieldCheck className="size-4 text-[#777984]" />}
                                    autoComplete={configured ? "current-password" : "new-password"}
                                    maxLength={128}
                                    placeholder={configured ? "用于进入你的个人账号；新密码至少 8 位" : "管理员个人密码至少 10 位"}
                                />
                            </Form.Item>
                            <Button className="login-realm-submit mt-1 !h-12" type="primary" htmlType="submit" block size="large" loading={submitting} icon={submitting ? undefined : <ArrowRight className="size-4" />}>
                                {submitting ? "正在叩问天地……" : configured ? "进入画界" : "完成初始化"}
                            </Button>
                        </Form>
                    </section>
                </div>
            </div>
        </LoginRealmBackground>
    );
}
