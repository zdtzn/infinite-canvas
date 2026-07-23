import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ProviderProtocol = "openai" | "gemini";

const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^fc/i,
    /^fd/i,
    /^fe80:/i,
];

export function assertAllowedUpstreamUrl(value: string) {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("接口地址无效");
    }
    if (url.protocol !== "https:") throw new Error("公网模式的接口地址必须使用 HTTPS");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) throw new Error("接口地址不能指向本机或内网");
    if (isIP(hostname) && isPrivateAddress(hostname)) throw new Error("接口地址不能指向本机或内网");
    return url;
}

export async function assertResolvedPublicUpstreamUrl(value: string | URL) {
    const url = assertAllowedUpstreamUrl(String(value));
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname)) {
        if (isPrivateAddress(hostname)) throw new Error("接口地址不能指向本机或内网");
        return url;
    }
    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new Error("接口域名无法解析");
    }
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("接口地址不能指向本机或内网");
    return url;
}

export function buildUpstreamUrl(baseUrl: string, protocol: ProviderProtocol, path: string) {
    const url = assertAllowedUpstreamUrl(baseUrl);
    const normalizedPath = `/${path.replace(/^\/+/, "")}`;
    const basePath = url.pathname.replace(/\/+$/, "");
    if (protocol === "gemini") {
        url.pathname = `${/\/(?:v1|v1beta)$/i.test(basePath) ? basePath : `${basePath}/v1beta`}${normalizedPath}`.replace(/\/{2,}/g, "/");
    } else {
        const hasApiVersion = /\/(?:v1|api\/v3|api\/plan\/v3)$/i.test(basePath);
        url.pathname = `${hasApiVersion ? basePath : `${basePath}/v1`}${normalizedPath}`.replace(/\/{2,}/g, "/");
    }
    return url.toString();
}

export function resolveAllowedRedirect(currentUrl: string | URL, location: string) {
    return assertAllowedUpstreamUrl(new URL(location, currentUrl).toString());
}

function isPrivateIpv4(hostname: string) {
    const parts = hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return (
        parts[0] === 0 ||
        parts[0] === 10 ||
        (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
        parts[0] === 127 ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
        parts[0] >= 224
    );
}

function isPrivateAddress(address: string) {
    const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
    if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
    if (isIP(normalized) !== 6) return true;
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("::ffff:");
}
