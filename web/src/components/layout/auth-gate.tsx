import { Alert, Button, Form, Input, Spin, Typography } from "antd";
import { LockKeyhole } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { fetchAuthStatus, loginAccess, setupAccess } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { PUBLIC_MODE } from "@/constant/runtime-config";

type AccessForm = { displayName: string; accessCode: string; personalCode: string };

export function AuthGate({ children }: { children: ReactNode }) {
    const user = useUserStore((state) => state.user);
    const setSession = useUserStore((state) => state.setSession);
    const clearSession = useUserStore((state) => state.clearSession);
    const [configured, setConfigured] = useState(true);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!PUBLIC_MODE) {
            setLoading(false);
            return;
        }
        let active = true;
        void fetchAuthStatus()
            .then((status) => {
                if (!active) return;
                setConfigured(status.configured);
                if (status.user) setSession({ id: status.user.userId, username: status.user.displayName, displayName: status.user.displayName, avatarUrl: status.user.avatarUrl || "", admin: status.user.admin });
                else clearSession();
            })
            .catch((reason) => active && setError(reason instanceof Error ? reason.message : "无法连接服务端"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [clearSession, setSession]);

    useEffect(() => {
        if (!PUBLIC_MODE) return;
        const handleInvalidSession = () => {
            clearSession();
            setError("登录状态已失效，请重新进入");
        };
        window.addEventListener("canvas:auth-invalid", handleInvalidSession);
        return () => window.removeEventListener("canvas:auth-invalid", handleInvalidSession);
    }, [clearSession]);

    const submit = async (values: AccessForm) => {
        setSubmitting(true);
        setError("");
        try {
            const result = configured ? await loginAccess(values) : await setupAccess(values);
            setSession({ id: result.user.userId, username: result.user.displayName, displayName: result.user.displayName, avatarUrl: result.user.avatarUrl || "", admin: result.user.admin });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    if (!PUBLIC_MODE) return <>{children}</>;
    if (loading) {
        return (
            <div className="grid h-dvh place-items-center bg-stone-50 dark:bg-stone-950">
                <Spin size="large" />
            </div>
        );
    }
    if (user) return <>{children}</>;

    return (
        <main className="grid min-h-dvh place-items-center bg-stone-100 px-4 py-8 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <section className="w-full max-w-[420px] rounded-lg border border-stone-200 bg-white p-7 shadow-lg dark:border-stone-800 dark:bg-stone-900">
                <div className="mb-6 flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-md bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950">
                        <LockKeyhole className="size-5" />
                    </span>
                    <div>
                        <Typography.Title level={3} className="!mb-0">
                            {configured ? "进入 AI 画布" : "初始化 AI 画布"}
                        </Typography.Title>
                        <Typography.Text type="secondary">{configured ? "共享口令进入站点，个人密码保护你的项目" : "首次使用，请设置管理员与站点口令"}</Typography.Text>
                    </div>
                </div>
                {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
                <Form<AccessForm> layout="vertical" onFinish={submit} initialValues={{ displayName: "" }}>
                    <Form.Item label="你的昵称" name="displayName" rules={[{ required: true, min: 2, message: "请输入至少 2 个字符" }]}>
                        <Input autoComplete="nickname" maxLength={32} placeholder="例如：小明" />
                    </Form.Item>
                    <Form.Item label={configured ? "访问口令" : "设置访问口令"} name="accessCode" rules={[{ required: true, min: 8, message: "口令至少 8 位" }]}>
                        <Input.Password autoComplete={configured ? "current-password" : "new-password"} placeholder="至少 8 位" />
                    </Form.Item>
                    <Form.Item label={configured ? "个人密码" : "设置个人密码"} name="personalCode" rules={[{ required: true, min: 6, message: "个人密码至少 6 位" }]}>
                        <Input.Password autoComplete={configured ? "current-password" : "new-password"} maxLength={128} placeholder="用于在其他设备进入自己的账号" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                        {configured ? "进入" : "完成初始化"}
                    </Button>
                </Form>
            </section>
        </main>
    );
}
