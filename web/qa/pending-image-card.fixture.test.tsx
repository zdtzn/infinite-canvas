import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PendingImageCard } from "@/pages/image/pending-image-card";
import type { GenerationResult } from "@/services/image-generation-runtime";

const pending: GenerationResult = { id: "pending", status: "pending", startedAt: 1, progress: { jobId: "task", phase: "waiting_upstream", reconnecting: false } };
const preview = { id: "preview", dataUrl: "https://images.example.com/preview.png", bytes: 10, durationMs: 1000, mimeType: "image/png", persisted: false };

test("a waiting card keeps the existing placeholder and cancellation action", () => {
    const html = renderToStaticMarkup(<PendingImageCard result={pending} onCancel={() => {}} />);
    expect(html).toContain("border-dashed");
    expect(html).toContain("radial-gradient");
    expect(html).toContain("生成中");
    expect(html).toContain("取消这张");
    expect(html).not.toContain("<img");
});

test("a running preview is clear above its status and never exposes final-image actions", () => {
    const html = renderToStaticMarkup(<PendingImageCard result={{ ...pending, progress: { ...pending.progress!, previewImage: preview } }} onCancel={() => {}} />);
    expect(html).toContain('src="https://images.example.com/preview.png"');
    expect(html).toContain('alt="生成预览"');
    expect(html).toContain("object-contain");
    expect(html).toContain("生成中");
    expect(html).toContain("取消这张");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf('role="status"'));
    expect(html).not.toMatch(/absolute|opacity-|bg-black|radial-gradient|继续创作|入藏卷阁|下载|保存/);
});

test("reconnecting and cancellation preserve the preview with the cancel state intact", () => {
    const html = renderToStaticMarkup(<PendingImageCard result={{ ...pending, cancelRequested: true, progress: { ...pending.progress!, reconnecting: true, previewImage: { ...preview, recoveryUrl: "https://relay.example.com/preview.png" } } }} onCancel={() => {}} />);
    expect(html).toContain('src="https://relay.example.com/preview.png"');
    expect(html).toContain("正在取消");
    expect(html).toContain("连接暂时中断");
    expect(html.match(/<button\b[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html).not.toMatch(/继续创作|入藏卷阁|下载/);
});
