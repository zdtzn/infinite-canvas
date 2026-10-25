import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { FailedImageCard } from "@/pages/image/failed-image-card";

test("a failed image shows guidance first and keeps one support reference in closed details", () => {
    const html = renderToStaticMarkup(<FailedImageCard id="fixture" error="Upstream request failed（任务编号 fixture12345）" isDouEmperor onRetry={() => {}} />);
    const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/^<details\b[^>]*\bopen(?:\s|=|>)/);
    const primary = html.replace(details!, "");
    expect(primary).toContain("再试一次");
    expect(primary).not.toMatch(/Upstream|fixture12345|任务编号|系统不会自动/);
    expect((html.match(/fixture12345/g) || []).length).toBe(1);
    expect(Object.values(canvasThemes).some((theme) => html.includes(`background:${theme.node.panel}`))).toBe(true);
    expect(html).not.toContain("bg-red-");
});

test("a history failure can label a whole-group retry and disable it during generation", () => {
    const html = renderToStaticMarkup(<FailedImageCard id="history" isDouEmperor onRetry={() => {}} retryLabel="重新生成4张" retryDisabled />);
    const retryButton = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes("重新生成4张"));
    expect(retryButton).toBeDefined();
    expect(retryButton).toContain('disabled=""');
    expect(html).toContain("这一笔未能成卷");
    expect(html).not.toContain("再试一次");
});
