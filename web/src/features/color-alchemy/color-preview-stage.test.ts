import { expect, test } from "bun:test";
import ts from "typescript";
import * as renderer from "./renderer";
import { createDefaultColorSettings } from "./settings";

test("preview effect cleanup aborts pending requests on source switch and unmount", async () => {
    // Execute the component's real effect with a minimal hook host; no DOM or module mocks leak into other tests.
    const code = ts.transpileModule(await Bun.file(new URL("./color-preview-stage.tsx", import.meta.url)).text(), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const effects: Array<() => () => void> = [];
    const hooks = {
        useRef: (current: unknown) => ({ current }),
        useState: (value: unknown) => [value, () => {}],
        useMemo: (fn: () => unknown) => fn(),
        useCallback: (fn: unknown) => fn,
        useEffect: (fn: () => () => void, deps: unknown[]) => {
            if (deps.includes("source-a") || deps.includes("source-b")) effects.push(fn);
        },
    };
    const exports: Record<string, (props: unknown) => unknown> = {};
    new Function("require", "exports", code)((name: string) => {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
        if (name === "./renderer") return renderer;
        if (name === "@/hooks/use-copy-text") return { useCopyText: () => () => {} };
        return {};
    }, exports);
    const originalFetch = globalThis.fetch;
    const signals: AbortSignal[] = [];
    let requestStarted!: () => void;
    globalThis.fetch = ((_input, init) => {
        signals.push(init!.signal as AbortSignal);
        requestStarted();
        return new Promise(() => {});
    }) as typeof fetch;
    let cleanup: (() => void) | undefined;
    try {
        for (const key of ["source-a", "source-b"]) {
            cleanup?.(); // React cleans the previous source effect before installing the next one.
            if (signals.length) expect(signals[0].aborted).toBe(true);
            exports.ColorPreviewStage({ source: { key, url: `/${key}.png` }, settings: createDefaultColorSettings(), viewMode: "adjusted" });
            const started = new Promise<void>((resolve) => {
                requestStarted = resolve;
            });
            cleanup = effects.pop()!();
            await started;
            expect(signals.at(-1)?.aborted).toBe(false);
        }
        cleanup?.(); // Unmount.
        expect(signals).toHaveLength(2);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        await Promise.resolve();
    } finally {
        cleanup?.();
        globalThis.fetch = originalFetch;
    }
});
