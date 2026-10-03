import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { observeHomepageShowcase } from "./loading";

const originalObserver = globalThis.IntersectionObserver;
afterEach(() => {
    if (originalObserver) globalThis.IntersectionObserver = originalObserver;
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

test("offscreen showcase waits for intersection and disconnects after activation", () => {
    let callback!: IntersectionObserverCallback;
    let disconnected = 0;
    let loaded = 0;
    let observed: Element | undefined;
    class Observer {
        constructor(cb: IntersectionObserverCallback, options: IntersectionObserverInit) {
            callback = cb;
            expect(options.rootMargin).toBe("0px");
        }
        observe(element: Element) {
            observed = element;
        }
        disconnect() {
            disconnected++;
        }
    }
    globalThis.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
    const element = {} as Element;
    const cleanup = observeHomepageShowcase(element, () => loaded++);
    expect(observed).toBe(element);
    expect(loaded).toBe(0);
    callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(loaded).toBe(0);
    callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(loaded).toBe(1);
    expect(disconnected).toBe(1);
    cleanup?.();
    expect(disconnected).toBe(2);
});

test("older browsers without IntersectionObserver still load the showcase", () => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    let loaded = false;
    observeHomepageShowcase({} as Element, () => {
        loaded = true;
    });
    expect(loaded).toBe(true);
});

test("home starts the correct hero without an extra lazy module or duplicate CSS image", () => {
    const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");
    const homeCss = readFileSync(new URL("./home.css", import.meta.url), "utf8");
    const routeLoaders = readFileSync(new URL("../../lib/route-loaders.ts", import.meta.url), "utf8");
    const authGate = readFileSync(new URL("../../components/layout/auth-gate.tsx", import.meta.url), "utf8");
    const imperialMode = readFileSync(new URL("../../features/cultivation/imperial-mode.tsx", import.meta.url), "utf8");
    expect(source).toContain('import ImperialRealm from "@/features/cultivation/imperial-realm"');
    expect(source).not.toContain("<Suspense");
    expect(source).not.toContain("loadingRealm");
    expect(source).toContain('fetchPriority="high"');
    expect(routeLoaders).not.toContain("hero-main.webp");
    expect(authGate).toContain("activateUser(status.user, setSession)");
    expect(authGate).toContain('window.location.pathname === "/"');
    expect(authGate).toContain('preload("/images/hero-main.webp"');
    expect(authGate).toContain('preload("/imperial/realm-scene-v2.webp"');
    expect(authGate).toContain('preload("/imperial/realm-scene-mobile-v2.webp"');
    expect(imperialMode).toContain("profile?.realmId ?? user?.realmId");
    expect(source).toContain("if (!showcaseEnabled) return;");
    expect(css).not.toContain("/images/hero-main.webp");
    expect(homeCss).toMatch(/\.shj-hero-image\s*\{[^}]*z-index: -2/s);
});

test("home scene crosses the seam without a new asset or an animated transition layer", () => {
    const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./home.css", import.meta.url), "utf8");
    const tail = css.match(/\.home-hero-stage::after\s*\{([^}]+)\}/s)?.[1] || "";
    expect(source.match(/className="home-hero-stage"/g)).toHaveLength(1);
    expect(source).toContain('className="home-hero-ink-fade" aria-hidden="true"');
    expect(source).not.toContain('className="shj-scroll-cue"');
    expect(css).toContain('--home-scene: url("/images/hero-main.webp")');
    expect(css).toContain('--home-scene: url("/imperial/realm-scene-v2.webp")');
    expect(css).toContain('--home-scene: url("/imperial/realm-scene-mobile-v2.webp")');
    expect(css).toContain("--home-scene-fade: clamp(180px, 26svh, 260px)");
    expect(tail).toContain("opacity: 0.05");
    expect(tail).toContain("pointer-events: none");
    expect(tail).not.toMatch(/animation|filter|will-change/);
});

test("home bridge overlap adapts to avoid covering the CTA in short windows", () => {
    const css = readFileSync(new URL("./home.css", import.meta.url), "utf8");
    expect(css).toContain("--home-bridge-overlap: 80px");
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?--home-bridge-overlap: 64px/);
    expect(css).toMatch(/@media \(max-height: 640px\)[\s\S]*?--home-bridge-overlap: 48px/);
    expect(css).toMatch(/@media \(max-height: 550px\)[\s\S]*?--home-bridge-overlap: 8px/);
    expect(css).toMatch(/\.home-cultivation-strip\s*\{[^}]*margin-top: calc\(-1 \* var\(--home-bridge-overlap\)\)/s);
});
