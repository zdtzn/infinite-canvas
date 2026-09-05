import { LoaderCircle } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useState } from "react";

import { LOGIN_TRANSITION_MS, LoginRealmBackground, LoginTransition, selectLoginTransitionMessage } from "@/components/auth/login-realm";
import { preloadAccountSessionRuntime } from "@/components/layout/account-session-controller";
import { fetchAuthStatus, loginAccess, setupAccess } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { PUBLIC_MODE } from "@/constant/runtime-config";

import { lazyRoute } from "@/lib/lazy-route";

const loadLoginForm = () => import("./login-form");
const LoginFormView = lazyRoute(loadLoginForm);

type AccessForm = { displayName: string; accessCode: string; personalCode: string };

export function AuthGate({ children }: { children: ReactNode }) {
    const user = useUserStore((state) => state.user);
    const setSession = useUserStore((state) => state.setSession);
    const clearSession = useUserStore((state) => state.clearSession);
    const [configured, setConfigured] = useState(true);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [transitionMessage, setTransitionMessage] = useState("");

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
                if (status.user) {
                    void preloadAccountSessionRuntime();
                    setSession({ id: status.user.userId, username: status.user.displayName, displayName: status.user.displayName, avatarUrl: status.user.avatarUrl || "", admin: status.user.admin });
                } else {
                    void loadLoginForm().catch(() => undefined);
                    clearSession();
                }
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
            void preloadAccountSessionRuntime();
            setTransitionMessage(selectLoginTransitionMessage(result.user.userId));
            const transitionDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 160 : LOGIN_TRANSITION_MS;
            await new Promise((resolve) => window.setTimeout(resolve, transitionDuration));
            setTransitionMessage("");
            setSession({ id: result.user.userId, username: result.user.displayName, displayName: result.user.displayName, avatarUrl: result.user.avatarUrl || "", admin: result.user.admin });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    if (!PUBLIC_MODE) return <>{children}</>;
    if (transitionMessage) return <LoginTransition message={transitionMessage} />;
    if (loading) return <AuthLoadingScreen />;
    if (user) return <>{children}</>;

    return (
        <Suspense fallback={<AuthLoadingScreen />}>
            <LoginFormView configured={configured} error={error} submitting={submitting} submit={submit} />
        </Suspense>
    );
}

function AuthLoadingScreen() {
    return (
        <LoginRealmBackground>
            <div className="grid min-h-dvh place-items-center px-6 text-center">
                <div className="flex flex-col items-center">
                    <span className="mb-6 size-11 bg-[#c9a86a]" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} aria-hidden="true" />
                    <LoaderCircle className="mb-4 size-5 animate-spin text-[#c9a86a]" aria-hidden="true" />
                    <p className="text-sm text-[#c9c4b9]">正在感知此方天地……</p>
                </div>
            </div>
        </LoginRealmBackground>
    );
}
