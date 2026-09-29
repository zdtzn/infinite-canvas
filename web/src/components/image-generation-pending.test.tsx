import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageGenerationPending } from "./image-generation-pending";
import type { ServerJobProgress } from "@/services/server-api";

test("SSR pending labels reflect real phases without fabricated percentages or promises", () => {
    const labels = { queued: "排队中", submitting: "提交中", waiting_upstream: "生成中", persisting: "正在传输并保存图片", completed: "生成完成" } as const;
    for (const [phase, label] of Object.entries(labels)) {
        const html = renderToStaticMarkup(createElement(ImageGenerationPending, { progress: { jobId: "one", phase: phase as ServerJobProgress["phase"], reconnecting: false } }));
        assert.ok(html.includes(label));
        assert.doesNotMatch(html, /\d+%<|马上|再等等|正在整理细节/);
        assert.match(html, /role="status"/);
    }
    const html = renderToStaticMarkup(createElement(ImageGenerationPending, { progress: { jobId: "one", phase: "waiting_upstream", reconnecting: true } }));
    assert.match(html, /重新连接中/);
    assert.match(html, /任务已保留，无需重新提交/);
});
