import { createParser } from "eventsource-parser";
import type { AxiosRequestConfig } from "axios";
import type { RunPluginArgs, PluginHttp, PluginPollOptions } from "./model-plugin";
import { withLocalProxy } from "./local-proxy";

type ScriptUtils = {
    http: PluginHttp;
    request: (config: AxiosRequestConfig & { url: string }) => Promise<unknown>;
    poll: <T, R>(request: () => Promise<T>, extract: (value: T) => R | null | undefined | false, options?: PluginPollOptions) => Promise<R>;
    sleep: (ms: number) => Promise<void>;
};

/** Keep public media URLs intact. Private files are read locally by protocols that support file contents. */
export function publicReferenceUrl(input: unknown, appOrigin = globalThis.location?.origin) {
    if (typeof input !== "string" || !/^https?:\/\//i.test(input)) return;
    let url: URL;
    try { url = new URL(input); } catch { return; }
    if (url.username || url.password || (url.origin === appOrigin && /^\/api(?:\/|$)/.test(url.pathname))) return;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("[")) {
        if (!/^\[[23][\da-f]{3}:/.test(host)) return;
    } else if (!host.includes(".") || /\.(?:localhost|local)$/.test(host)) return;
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        const [first, second] = host.split(".").map(Number);
        if ([0, 10, 127].includes(first) || first >= 224 || (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) ||
            (first === 198 && (second === 18 || second === 19))) return;
    }
    return input;
}

export async function runMainCallScript<T>(args: RunPluginArgs, utils: ScriptUtils): Promise<T> {
    args.signal?.throwIfAborted();
    const toBlob = async (input: string | Blob) => {
        if (input instanceof Blob) return input;
        const response = await fetch(input.startsWith("http") ? withLocalProxy(input) : input, { signal: args.signal });
        if (!response.ok) throw new Error("参考素材读取失败");
        return response.blob();
    };
    const toDataUrl = async (input: string | Blob) => {
        if (typeof input === "string" && input.startsWith("data:")) return input;
        const blob = await toBlob(input);
        args.signal?.throwIfAborted();
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            const abort = () => { reader.abort(); reject(args.signal?.reason); };
            args.signal?.addEventListener("abort", abort, { once: true });
            reader.onloadend = () => { args.signal?.removeEventListener("abort", abort); };
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("参考素材读取失败"));
            reader.readAsDataURL(blob);
        });
    };
    const main = new Function(`"use strict";\n${args.script}\nreturn main;`)();
    const mediaSource = (source: string | File) => typeof source === "string" ? source : toDataUrl(source);
    const videos = await Promise.all((args.videos || []).map(mediaSource));
    const audios = await Promise.all((args.audios || []).map(mediaSource));
    args.signal?.throwIfAborted();
    const options = { ...args.params };
    if (args.capability === "image") options.resolution = ({ low: "1K", medium: "2K", high: "4K" } as Record<string, string>)[String(options.resolution)] || options.resolution;
    return main({
        capability: args.capability, model: args.config.model, baseUrl: args.config.baseUrl, apiKey: args.config.apiKey,
        systemPrompt: args.config.systemPrompt, reasoningEffort: args.config.reasoningEffort,
        prompt: args.prompt || "", images: args.images || [], videos, audios,
        messages: args.messages || [], options, taskId: args.taskId, signal: args.signal,
        utils: {
            ...utils, onDelta: args.onDelta ?? (() => {}), toBlob, toDataUrl,
            request: (config: AxiosRequestConfig & { url: string }) => utils.request({ ...config, timeout: config.timeout ?? (args.taskId ? 30_000 : 600_000) }),
            http: {
                ...utils.http,
                get: (path: string, options?: Parameters<PluginHttp["get"]>[1]) => utils.http.get(path, { timeout: 30_000, ...options }),
                post: (path: string, body?: unknown, options?: Parameters<PluginHttp["post"]>[2]) => utils.http.post(path, body, { timeout: 600_000, ...options }),
            },
            toPublicUrl: async (input: string | Blob) => {
                const url = publicReferenceUrl(input);
                if (url) return url;
                throw new Error("该协议需要可公开访问的参考素材链接，请使用公网链接；本机图片和登录后才能读取的素材不能直接提交");
            },
            markdownImages: async (source: string) => {
                const { lexer, walkTokens } = await import("marked");
                const urls: string[] = [];
                walkTokens(lexer(source), token => { if (token.type === "image") urls.push(token.href); });
                return urls;
            },
            markdownLinks: async (source: string) => {
                const { lexer, walkTokens } = await import("marked");
                const urls: string[] = [];
                walkTokens(lexer(source), token => { if (token.type === "link") urls.push(token.href); });
                return urls;
            },
            stream: async (config: { url: string; headers?: Record<string, string>; data: unknown }, onEvent: (event: Record<string, unknown>) => void) => {
                const timeout = AbortSignal.timeout(600_000);
                const response = await fetch(withLocalProxy(config.url), { method: "POST", headers: { "Content-Type": "application/json", ...config.headers }, body: JSON.stringify(config.data), signal: args.signal ? AbortSignal.any([args.signal, timeout]) : timeout });
                if (!response.ok) throw new Error(`文本服务暂不可用 (${response.status})`);
                if (!response.headers.get("content-type")?.includes("text/event-stream")) { onEvent(await response.json()); return; }
                if (!response.body) throw new Error("文本服务返回内容为空");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const parser = createParser({ onEvent: ({ data }) => { if (data && data !== "[DONE]") onEvent(JSON.parse(data)); } });
                try {
                    for (;;) {
                        args.signal?.throwIfAborted();
                        const { value, done } = await reader.read();
                        if (done) { parser.feed(decoder.decode()); break; }
                        parser.feed(decoder.decode(value, { stream: true }));
                    }
                } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            },
        },
    });
}
