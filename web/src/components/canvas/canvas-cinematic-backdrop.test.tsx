import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";

import { CANVAS_CINEMATIC_VIDEO_URL, CanvasCinematicBackdrop } from "./canvas-cinematic-backdrop";

test("cinematic canvas backdrop renders a muted looping inline video", () => {
    const html = renderToStaticMarkup(<CanvasCinematicBackdrop enabled colorTheme="dark" />);

    expect(html).toContain(CANVAS_CINEMATIC_VIDEO_URL.replaceAll("&", "&amp;"));
    expect(html).toContain('autoPlay=""');
    expect(html).toContain("muted");
    expect(html).toContain("loop");
    expect(html).toContain('playsInline=""');
    expect(html).toContain("canvas-bottom-blur");
});

test("cinematic canvas backdrop unmounts its video when disabled", () => {
    const html = renderToStaticMarkup(<CanvasCinematicBackdrop enabled={false} colorTheme="dark" />);

    expect(html).toBe("");
});
