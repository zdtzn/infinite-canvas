import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("./auth-gate.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("auth-gate.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let startupEffect = "";
function findEffect(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" && node.arguments[0]?.getText(parsed).includes("fetchAuthStatus()")) startupEffect = node.arguments[0].getText(parsed);
    ts.forEachChild(node, findEffect);
}
findEffect(parsed);

// Execute the real effect with controlled promises, without globally mocking React
// or the session store (which would leak into other Bun tests).
function runStartup(publicMode = true) {
    expect(startupEffect).not.toBe("");
    const events: unknown[][] = [];
    let resolveAuth!: (value: { configured: boolean; user: unknown; emailRegistrationEnabled?: boolean; passwordResetEnabled?: boolean }) => void;
    let rejectAuth!: (reason: Error) => void;
    const auth = new Promise((resolve, reject) => {
        resolveAuth = resolve;
        rejectAuth = reject;
    });
    const record =
        (name: string) =>
        (...args: unknown[]) => {
            events.push([name, ...args]);
        };
    const bindings = {
        PUBLIC_MODE: publicMode,
        window: { location: { pathname: "/chat" } },
        preloadRoute: (...args: unknown[]) => {
            events.push(["preload", ...args]);
            return new Promise(() => {});
        },
        fetchAuthStatus: () => {
            events.push(["auth"]);
            return auth;
        },
        preloadAccountSessionRuntime: record("runtime"),
        activateUser: record("activate"),
        setSession: record("session"),
        clearSession: record("clear"),
        loadLoginForm: () => {
            events.push(["login-form"]);
            return Promise.resolve();
        },
        setLoading: record("loading"),
        setConfigured: record("configured"),
        setRegistrationEnabled: record("registration"),
        setPasswordResetEnabled: record("password-reset"),
        setError: record("error"),
    };
    const compiled = ts.transpileModule(`const run = ${startupEffect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const cleanup = new Function(...Object.keys(bindings), `${compiled}\nreturn run();`)(...Object.values(bindings)) as (() => void) | undefined;
    return { events, resolveAuth, rejectAuth, cleanup };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("current route imports start alongside auth, with no intent data prefetch", async () => {
    const { events, resolveAuth } = runStartup();
    expect(events).toEqual([["preload", "/chat", { fromWarmup: true }], ["auth"]]);
    const user = { userId: "verified" };
    resolveAuth({ configured: true, user });
    await settle();
    expect(events.some(([name]) => name === "error")).toBe(false);
    expect(events.some(([name]) => name === "activate")).toBe(true);
    expect(events.at(-1)).toEqual(["loading", false]);
    // An unresolved route import must not delay auth success.
    expect(events.find(([name]) => name === "activate")?.[1]).toBe(user);
});

test("anonymous auth retains login and never activates an account", async () => {
    const { events, resolveAuth } = runStartup();
    resolveAuth({ configured: false, user: null });
    await settle();
    expect(events.some(([name]) => name === "error")).toBe(false);
    expect(events).toContainEqual(["clear"]);
    expect(events).toContainEqual(["login-form"]);
    expect(events.some(([name]) => name === "activate" || name === "runtime")).toBe(false);
});

test("password reset availability is independent of registration and defaults off when absent", async () => {
    for (const passwordResetEnabled of [true, false, undefined]) {
        const { events, resolveAuth } = runStartup();
        resolveAuth({ configured: true, user: null, emailRegistrationEnabled: false, passwordResetEnabled });
        await settle();
        expect(events).toContainEqual(["registration", false]);
        expect(events).toContainEqual(["password-reset", Boolean(passwordResetEnabled)]);
        expect(events).toContainEqual(["clear"]);
        expect(events).toContainEqual(["login-form"]);
        expect(events.some(([name]) => name === "error" || name === "activate" || name === "runtime")).toBe(false);
        expect(events.at(-1)).toEqual(["loading", false]);
    }
});

test("failed or cancelled auth cannot activate a preloaded route", async () => {
    const failed = runStartup();
    failed.rejectAuth(new Error("offline"));
    await settle();
    expect(failed.events).toContainEqual(["error", "offline"]);
    expect(failed.events.some(([name]) => name === "activate")).toBe(false);
    const cancelled = runStartup();
    cancelled.cleanup?.();
    cancelled.resolveAuth({ configured: true, user: { userId: "late" }, passwordResetEnabled: true });
    await settle();
    expect(cancelled.events).toHaveLength(2);
});

test("non-public mode preloads code without making an auth request", () => {
    expect(runStartup(false).events).toEqual([
        ["preload", "/chat", { fromWarmup: true }],
        ["loading", false],
    ]);
});

test("protected children still wait for loading and session checks", () => {
    expect(source.indexOf("if (loading) return <AuthLoadingScreen />")).toBeLessThan(source.indexOf("if (user) return <>{children}</>"));
    expect(source).toContain("<LoginFormView");
    expect(source).toContain("passwordResetEnabled={passwordResetEnabled}");
    const loaders = readFileSync(new URL("../../lib/route-loaders.ts", import.meta.url), "utf8");
    expect(loaders).toContain('if (!options.fromWarmup && routeKey === "/chat")');
});

test("version release UI is a separate lazy module with an immediate version label", () => {
    const actions = readFileSync(new URL("./user-status-actions.tsx", import.meta.url), "utf8");
    expect(actions).not.toMatch(/import\s+\{\s*VersionReleaseModal\s*\}\s+from/);
    expect(actions).toContain('lazyRoute(() => import("@/components/layout/version-release-modal")');
    expect(actions.replace(/\s+/g, "")).toMatch(/<Suspensefallback=\{<span[^>]*>\{APP_VERSION\}<\/span>\}><VersionReleaseModalstyle=\{versionStyle\}\/>/);
});
