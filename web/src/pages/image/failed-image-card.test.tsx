import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { FailedImageCard } from "./failed-image-card";

test("a failed image shows guidance first and keeps one support reference in closed details", () => {
    const theme = useThemeStore.getInitialState().theme;
    const html = renderToStaticMarkup(<FailedImageCard id="fixture" error="Upstream request failed（任务编号 fixture12345）" isDouEmperor onRetry={() => {}} />);
    const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/^<details\b[^>]*\bopen(?:\s|=|>)/);
    const primary = html.replace(details!, "");
    expect(primary).toContain("再试一次");
    expect(primary).not.toMatch(/Upstream|fixture12345|任务编号|系统不会自动/);
    expect((html.match(/fixture12345/g) || []).length).toBe(1);
    expect(html).toContain(`background:${canvasThemes[theme].node.panel}`);
    expect(html).not.toContain("bg-red-");
});
