import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Opt in: uses only a fresh disposable profile and loopback fixture, never a user session.
const chrome = process.env.TELEMETRY_TEST_CHROME;
test.skipIf(!chrome || !existsSync(chrome))("isolated Chrome: real lazy module, StrictMode, canceled navigation and private request headers", async () => {
    const root = resolve(import.meta.dir, "..").replaceAll("\\", "/");
    // Execute the production wrapper with the real browser router, without loading app pages/auth.
    const routerSource = await Bun.file(new URL("../router.tsx", import.meta.url)).text();
    const routePage = routerSource.slice(routerSource.indexOf("function RoutePage("), routerSource.indexOf("function RouteLoading("));
    const source = `
        import React, { StrictMode, lazy, useState, useEffect, type ReactNode } from "react";
        import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import { MeasuredRoute } from ${JSON.stringify(`${root}/components/route-performance.tsx`)};
        import { useUserStore } from ${JSON.stringify(`${root}/stores/use-user-store.ts`)};
        const clock = performance.now.bind(performance);
        let offset = 0;
        Object.defineProperty(performance, "now", { value: () => clock() + offset });
        const session = (id) => useUserStore.getState().setSession({ id, username: id, displayName: id, avatarUrl: "" });
        session("fixture-only");
        const slowUrl = "/slow.js";
        const Slow = lazy(() => import(slowUrl));
        const scenario = new URLSearchParams(location.search).get("scenario");
        ${routePage}
        function RouteLoading() { return <p>loading-module</p>; }
        window.mounts = 0;
        function StatefulPage() {
            const [filter, setFilter] = useState("initial");
            useEffect(() => { window.mounts++; }, []);
            return <><button id="filter-button" onClick={() => setFilter("blue")}>filter</button><output id="filter">{filter}</output></>;
        }
        function App() {
            const current = useLocation();
            const navigate = useNavigate();
            const page = current.pathname === "/image";
            window.qa = {
                changeOwner: () => { offset += 7000; flushSync(() => session("fixture-other")); },
                navigate: () => flushSync(() => navigate("/image")),
                query: () => { offset += 7000; flushSync(() => navigate("?filter=blue")); },
                hash: () => flushSync(() => navigate({ search: current.search, hash: "#results" })),
                pathname: () => flushSync(() => navigate("/canvas/another-id")),
            };
            return <RoutePage>
                {scenario === "filters" ? <StatefulPage /> : page || scenario === "frames" ? <p>ready-page</p> : <Slow />}
            </RoutePage>;
        }
        flushSync(() => createRoot(document.getElementById("root")).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>));
        if (scenario === "cancel") setTimeout(() => window.qa.navigate(), 40);
        if (scenario === "frames") requestAnimationFrame(() => window.qa.navigate());
    `;
    const build = await Bun.build({
        entrypoints: ["telemetry-browser-fixture"], target: "browser", format: "esm",
        define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
        plugins: [{ name: "fixture", setup(builder) {
            builder.onResolve({ filter: /^telemetry-browser-fixture$/ }, () => ({ path: "fixture", namespace: "fixture" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: source, loader: "tsx", resolveDir: resolve(import.meta.dir, "../..") }));
        } }],
    });
    expect(build.success).toBe(true);
    const script = await build.outputs[0].text();
    const requests: Array<{ referer: string | null; body: { samples: Array<{ route: string; name: string; durationMs: number }> } }> = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/fixture.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (url.pathname === "/slow.js") {
            await Bun.sleep(260);
            return new Response('export default function Slow(){ return "slow-ready"; }', { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } });
        }
        if (url.pathname === "/api/performance") {
            requests.push({ referer: request.headers.get("referer"), body: await request.json() });
            return new Response(null, { status: 204 });
        }
        return new Response('<!doctype html><div id="root"></div><script>window.__RUNTIME_CONFIG__={PUBLIC_MODE:true}</script><script type="module" src="/fixture.js"></script>', { headers: { "Content-Type": "text/html" } });
    } });
    const profile = await mkdtemp(join(tmpdir(), "telemetry-chrome-"));
    const child = spawn(chrome!, ["--headless=new", "--disable-background-networking", "--disable-component-update", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
    let socket: WebSocket | undefined;
    let closeBrowser: (() => void) | undefined;
    try {
        const deadline = Date.now() + 10000;
        let port = "";
        while (!port && Date.now() < deadline) {
            port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then((text) => text.split("\n")[0]).catch(() => "");
            if (!port) await Bun.sleep(50);
        }
        expect(port).not.toBe("");
        const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json()) as { webSocketDebuggerUrl: string };
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = reject; });
        let sequence = 0;
        const pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>();
        socket.onmessage = (event) => {
            const value = JSON.parse(String(event.data));
            const entry = pending.get(value.id);
            if (!entry) return;
            pending.delete(value.id);
            if (value.error) entry.reject(value.error); else entry.resolve(value.result);
        };
        const command = (method: string, params = {}) => new Promise<any>((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve, reject });
            socket!.send(JSON.stringify({ id, method, params }));
        });
        closeBrowser = () => { void command("Browser.close").catch(() => undefined); };
        const evaluate = async (expression: string) => {
            const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        for (const scenario of ["slow", "cancel", "frames", "filters"]) {
            requests.length = 0;
            await command("Page.navigate", { url: `http://127.0.0.1:${server.port}/canvas/private-id?token=private&scenario=${scenario}` });
            const limit = Date.now() + 5000;
            while (!requests.length && Date.now() < limit) await Bun.sleep(25);
            expect(requests).toHaveLength(1);
            const samples = requests.flatMap((request) => request.body.samples).filter((sample) => sample.name === "route_ready");
            expect(samples).toHaveLength(1);
            expect(samples[0].route).toBe(scenario === "slow" || scenario === "filters" ? "/canvas/:id" : "/image");
            const documentSamples = requests[0].body.samples.filter((sample) => sample.name !== "route_ready");
            expect(documentSamples).toHaveLength(2);
            expect(documentSamples.every((sample) => sample.route === "/canvas/:id")).toBe(true);
            if (scenario === "slow") expect(samples[0].durationMs).toBeGreaterThanOrEqual(250);
            expect(requests[0].referer).toBeNull();
            expect(JSON.stringify(requests)).not.toContain("private");
            if (scenario === "filters") {
                await evaluate('document.getElementById("filter-button").click(); window.savedFilter = document.getElementById("filter"); void 0;');
                await Bun.sleep(30);
                const mounts = await evaluate("window.mounts");
                for (const update of ["query", "hash"]) {
                    await evaluate(`window.qa.${update}()`);
                    await Bun.sleep(100);
                    expect(await evaluate('document.getElementById("filter").textContent')).toBe("blue");
                    expect(await evaluate('window.savedFilter === document.getElementById("filter")')).toBe(true);
                    expect(await evaluate("window.mounts")).toBe(mounts);
                    expect(requests).toHaveLength(1);
                }
                expect(await evaluate("location.search + location.hash")).toBe("?filter=blue#results");
                await evaluate("window.qa.pathname()");
                const resetDeadline = Date.now() + 2000;
                while (requests.length < 2 && Date.now() < resetDeadline) await Bun.sleep(25);
                expect(await evaluate('document.getElementById("filter").textContent')).toBe("initial");
                expect(await evaluate("window.mounts")).toBeGreaterThan(mounts);
                expect(requests).toHaveLength(2);
                expect(requests[1].body.samples).toHaveLength(1);
                console.log("telemetry browser filters: query/hash preserve state, DOM identity and mount count; pathname resets and samples once");
                continue;
            }
            await evaluate("window.qa.changeOwner()");
            await Bun.sleep(400); // Also let the abandoned slow import resolve.
            expect(requests).toHaveLength(1);
            console.log(`telemetry browser ${scenario}: one route sample, ${samples[0].durationMs}ms, no Referer, no account-change duplicate`);
        }
    } finally {
        closeBrowser?.();
        const exitDeadline = Date.now() + 2000;
        while (child.exitCode === null && Date.now() < exitDeadline) await Bun.sleep(50);
        socket?.close();
        if (child.exitCode === null) child.kill();
        server.stop(true);
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch((error) => console.warn(`Fixture profile cleanup: ${error.message}`));
    }
}, 30000);
