import { useLocalProxyStore, normalizeLocalProxyUrl } from "@/stores/use-local-proxy-store";

export function ConfigLocalProxy() {
    const { enabled, url, setEnabled, setUrl } = useLocalProxyStore();
    const valid = Boolean(normalizeLocalProxyUrl(url));
    return (
        <section className="mt-5 space-y-2 text-sm">
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={enabled} disabled={!valid && !enabled} onChange={(event) => setEnabled(event.target.checked)} />
                使用本地代理
            </label>
            <p className="text-xs opacity-70">可选：用于自定义渠道和 WebDAV。请先启动本机 canvas-proxy 并配置本站及目标服务的允许来源。代理会接收这些请求的凭据。</p>
            <label className="block">
                本地代理地址
                <input className="mt-1 block w-full rounded border border-current/20 bg-transparent px-3 py-2" value={url} onChange={(event) => setUrl(event.target.value)} aria-invalid={!valid} placeholder="http://127.0.0.1:8789" />
            </label>
            {!valid && <p role="alert">请填写有效的回环地址，不含路径、参数或密码。</p>}
        </section>
    );
}
