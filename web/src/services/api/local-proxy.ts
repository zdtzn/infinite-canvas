import { normalizeLocalProxyUrl, useLocalProxyStore } from "@/stores/use-local-proxy-store";

/** Apply to the completed direct URL. Relative backend routes always remain same-origin. */
export function withLocalProxy(url: string): string {
    const config = useLocalProxyStore.getState();
    if (!config.enabled || !/^https?:\/\//i.test(url)) return url;
    const base = normalizeLocalProxyUrl(config.url);
    if (!base) throw new Error("本地代理地址必须是 localhost、127.0.0.1 或 [::1] 的 HTTP(S) 地址");
    const target = new URL(url);
    if (target.origin === base || (typeof location !== "undefined" && target.origin === location.origin)) return url;
    if (target.username || target.password) throw new Error("目标地址不能包含用户名或密码");
    return `${base}/proxy/${url}`;
}
