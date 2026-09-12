import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createProxy, parseOrigins } from "./index.mjs";

test("origin and target guards; streamed forwarding; no cookies or redirects", async () => {
    let hits = 0;
    const target = createServer((req, res) => {
        hits++;
        if (req.url === "/redirect") { res.writeHead(302, { Location: "http://127.0.0.1:1/private" }); return res.end(); }
        res.setHeader("Set-Cookie", "private=1");
        res.end(JSON.stringify({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization }));
    });
    await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
    const destination = `http://127.0.0.1:${target.address().port}`;
    const proxy = createProxy({ origins: parseOrigins("https://canvas.example"), targets: parseOrigins(destination, true) });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${proxy.address().port}`;
    const headers = { Origin: "https://canvas.example" };
    try {
        assert.equal((await fetch(`${base}/proxy/${destination}/`, { headers: { Origin: "https://evil.example" } })).status, 403);
        assert.equal((await fetch(`${base}/proxy/https://unlisted.example/`, { headers })).status, 403);
        assert.equal(hits, 0);
        const response = await fetch(`${base}/proxy/${destination}/media?x=a%2Fb`, { headers: { ...headers, Cookie: "private=1", Authorization: "Bearer test" } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.deepEqual(await response.json(), { url: "/media?x=a%2Fb", authorization: "Bearer test" });
        assert.equal((await fetch(`${base}/proxy/${destination}/redirect`, { headers })).status, 502);
        assert.equal((await fetch(base, { method: "OPTIONS", headers })).status, 204);
        assert.throws(() => parseOrigins("http://remote.example", true));
    } finally { proxy.closeAllConnections(); target.closeAllConnections(); await Promise.all([new Promise((resolve) => proxy.close(resolve)), new Promise((resolve) => target.close(resolve))]); }
});
