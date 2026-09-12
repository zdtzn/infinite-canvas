#!/usr/bin/env node
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const skipped = new Set(["host", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "content-length", "accept-encoding", "origin", "referer", "cookie", "set-cookie", "proxy-authorization", "proxy-authenticate"]);

export function parseOrigins(value, target = false) {
    return new Set(value.split(",").filter(Boolean).map((entry) => {
        const url = new URL(entry.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid allowed origin");
        if (target && url.protocol === "http:" && !loopback.has(url.hostname)) throw new Error("Remote targets require HTTPS");
        return url.origin;
    }));
}

export function createProxy({ origins, targets }) {
    return createServer(async (req, res) => {
        const fail = (status) => { if (res.headersSent) res.destroy(); else { res.writeHead(status); res.end("Local proxy request rejected"); } };
        const origin = req.headers.origin;
        // Both Host and Origin are checked, including preflights (DNS rebinding defense).
        let host;
        try { host = new URL(`http://${req.headers.host}`).hostname; } catch { return fail(403); }
        if (!loopback.has(host) || !origin || !origins.has(origin)) return fail(403);
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS,PROPFIND,MKCOL");
        res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "Content-Type,Authorization");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.setHeader("Access-Control-Expose-Headers", "Content-Type,ETag,Retry-After");
        if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
        if (req.url === "/" && req.method === "GET") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ proxy: "canvas-proxy", version: "1" })); }
        if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'PROPFIND', 'MKCOL'].includes(req.method)) return fail(405);
        let target;
        try {
            if (!req.url.startsWith("/proxy/")) return fail(400);
            target = new URL(req.url.slice(7));
            if (target.username || target.password || !targets.has(target.origin)) return fail(403);
            if (target.protocol !== "https:" && !(target.protocol === "http:" && loopback.has(target.hostname))) return fail(403);
        } catch { return fail(400); }
        const headers = new Headers();
        const connectionHeaders = new Set(String(req.headers.connection || "").toLowerCase().split(",").map((item) => item.trim()));
        for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined || skipped.has(key) || connectionHeaders.has(key) || key.startsWith("sec-") || key.startsWith("access-control-")) continue;
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 600_000);
        res.on("close", () => controller.abort());
        try {
            const upstream = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req, duplex: "half", redirect: "error", signal: controller.signal });
            upstream.headers.forEach((value, key) => {
                if (!skipped.has(key) && key !== "content-encoding" && !key.startsWith("access-control-")) res.setHeader(key, value);
            });
            res.writeHead(upstream.status);
            if (!upstream.body) res.end();
            else {
                const stream = Readable.fromWeb(upstream.body);
                stream.on("error", () => res.destroy());
                res.on("close", () => stream.destroy());
                stream.pipe(res);
                await new Promise((resolve) => res.on("close", resolve));
            }
        } catch { fail(502); }
        finally { clearTimeout(timer); }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const origins = parseOrigins(process.env.CANVAS_PROXY_ORIGINS || "");
    const targets = parseOrigins(process.env.CANVAS_PROXY_TARGETS || "", true);
    const port = Number(process.env.CANVAS_PROXY_PORT || 8789);
    if (!origins.size || !targets.size || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Configure CANVAS_PROXY_ORIGINS, CANVAS_PROXY_TARGETS and a valid port");
    createProxy({ origins, targets }).listen(port, "127.0.0.1", () => console.log(`canvas-proxy listening on 127.0.0.1:${port}`));
}
