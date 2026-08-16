const LOCAL_AGENT_CONNECT_SOURCES = ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"];

export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' blob: wasm-unsafe-eval https://www.googletagmanager.com https://hm.baidu.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    `connect-src 'self' https: data: blob: ${LOCAL_AGENT_CONNECT_SOURCES.join(" ")}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
].join("; ");
