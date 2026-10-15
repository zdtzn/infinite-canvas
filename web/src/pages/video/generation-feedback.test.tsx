import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { VideoGenerationLog } from "@/services/video-task-model";
import { FailedVideoCard, PendingVideoCard } from "./index";
import { VideoTaskItem } from "@/components/layout/task-center";

function primaryMarkup(html: string) {
    const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/^<details\b[^>]*\bopen(?:\s|=|>)/);
    return html.replace(details!, "");
}

test("video failure keeps provider errors in closed details", () => {
    const html = renderToStaticMarkup(<FailedVideoCard error="Upstream request failed（任务编号 fixture12345）" onRetry={() => {}} />);
    const primary = primaryMarkup(html);
    expect(primary).toContain("再试一次");
    expect(primary).not.toMatch(/fixture12345|任务编号|Upstream/);
    expect(html).not.toContain("bg-red-");
    expect((html.match(/fixture12345/g) || []).length).toBe(1);
});

test("an uncertain video result keeps the repeated charge warning visible", () => {
    const html = renderToStaticMarkup(<FailedVideoCard uncertain error="Network Error" onRetry={() => {}} />);
    const primary = primaryMarkup(html);
    expect(primary).toContain("还没能确认生成结果");
    expect(primary).toContain("重新生成可能再次计费");
    expect(primary).not.toContain("这个视频没能生成");
});

test("stopped submission shows result confirmation without internal identifier handling", () => {
    const log = { id: "fixture", phase: "submitting", status: "生成中", trackingStopped: true, error: "已停止后续查询，正在接收任务编号；上游可能仍在生成和计费。" } as VideoGenerationLog;
    const primary = primaryMarkup(renderToStaticMarkup(<PendingVideoCard log={log} onResume={() => {}} onStop={() => {}} />));
    expect(primary).toContain("正在确认结果");
    expect(primary).toContain("仍可能继续生成并计费");
    expect(primary).not.toMatch(/任务编号|停止查询/);
});

test("task center keeps uncertain and paused video charge warnings outside details", () => {
    for (const phase of ["unknown", "paused", "submitting"] as const) {
        const job = { id: "fixture", phase, status: "生成中", trackingStopped: true, task: phase === "paused" ? { id: "fixture12345" } : undefined, error: "视频创建失败（HTTP 500），创建结果未确认（任务编号 fixture12345）" } as VideoGenerationLog;
        const html = renderToStaticMarkup(<VideoTaskItem job={job} onOpen={() => {}} onStop={() => {}} onResume={() => {}} onDismiss={() => {}} />);
        const primary = primaryMarkup(html);
        expect(primary).toContain(phase === "unknown" ? "重新生成可能再次计费" : "仍可能继续生成并计费");
        expect(primary).not.toMatch(/HTTP|fixture12345|任务编号/);
        if (phase === "paused") expect(primary).toContain("继续查看");
    }
});
