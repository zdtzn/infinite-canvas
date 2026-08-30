import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, mock, test } from "bun:test";

mock.module("@/stores/use-theme-store", () => ({
    useThemeStore: (selector: (state: { theme: "dark" }) => unknown) => selector({ theme: "dark" }),
}));

test("canvas viewport overlay stays outside the transformed world layer", async () => {
    const { InfiniteCanvas } = await import("./infinite-canvas");
    const html = renderToStaticMarkup(
        createElement(
            InfiniteCanvas as typeof InfiniteCanvas & ((props: { overlay?: React.ReactNode }) => React.ReactNode),
            {
                containerRef: createRef<HTMLDivElement>(),
                viewport: { x: 120, y: 80, k: 0.75 },
                backgroundMode: "blank",
                onViewportChange: () => undefined,
                overlay: createElement("section", null, "EMPTY_OVERLAY"),
            },
            createElement("span", null, "WORLD_CONTENT"),
        ),
    );

    const worldStart = html.indexOf('data-canvas-world="true"');
    const overlayStart = html.indexOf('data-canvas-overlay="true"');
    const worldEnd = html.indexOf("</div>", worldStart);

    expect(worldStart).toBeGreaterThan(-1);
    expect(overlayStart).toBeGreaterThan(worldStart);
    expect(worldEnd).toBeLessThan(overlayStart);
    expect(html.slice(worldStart, worldEnd)).toContain("WORLD_CONTENT");
    expect(html.slice(worldStart, worldEnd)).not.toContain("EMPTY_OVERLAY");
    expect(html.slice(overlayStart)).toContain("EMPTY_OVERLAY");
    expect(html).toContain('data-canvas-no-zoom="true"');
});
