import { expect, test } from "bun:test";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await Bun.file(new URL("./user-layout.tsx", import.meta.url)).text();
const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function renderLayout(pathname: string, ready = true) {
    const mountedModules: string[] = [];
    const exports: Record<string, React.ComponentType<{ children: React.ReactNode }>> = {};
    // Keep mocks local to this module host; execute the production layout with real React rendering.
    new Function("require", "exports", code)((name: string) => {
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return require("react/jsx-runtime");
        if (name === "react-router-dom") return { useLocation: () => ({ pathname }) };
        if (name === "@/components/layout/app-top-nav") return { AppTopNav: () => null };
        if (name === "@/features/cultivation/imperial-mode") return { useImperialMode: () => ({ isDouEmperor: false, isImperialMode: false }) };
        if (name === "@/hooks/use-deferred-mount") return { useDeferredMount: () => ready };
        if (name === "@/lib/route-loaders") return { warmupRoutesWhenIdle: () => () => {} };
        if (name === "@/lib/utils") return { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") };
        if (name === "@/lib/lazy-route") return {
            lazyRoute: (loader: () => unknown) => function LazyModule() {
                mountedModules.push(loader.toString());
                return null;
            },
        };
        throw new Error(`Unexpected layout dependency: ${name}`);
    }, exports);
    const html = renderToStaticMarkup(createElement(exports.default, { children: createElement("main", null, "创作内容") }));
    return { html, splashMounted: mountedModules.some((loader) => loader.includes("splash-cursor")) };
}

test("creation and account routes do not mount the full-screen fluid cursor after deferred initialization", () => {
    for (const route of ["/image", "/canvas", "/canvas/fixture-project", "/chat", "/video", "/assets", "/prompts", "/color-alchemy", "/config", "/wallet", "/cultivation", "/admin/cultivation", "/announcements", "/docs"]) {
        const rendered = renderLayout(route);
        expect(rendered.html).toContain("创作内容");
        expect(rendered.splashMounted, route).toBe(false);
    }
});

test("the fluid cursor mounts only on the home page after deferred initialization", () => {
    expect(renderLayout("/", false).splashMounted).toBe(false);
    expect(renderLayout("/").splashMounted).toBe(true);
    expect(renderLayout("/image").splashMounted).toBe(false);
});
