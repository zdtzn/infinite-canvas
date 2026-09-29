import { describe, expect, it } from "bun:test";
import { summarizeImageTasks } from "./task-summary";

describe("image task summary", () => {
    it("counts actual phases and pending persistence independently", () => {
        const progress = (phase: "queued" | "submitting" | "waiting_upstream" | "persisting" | "completed", reconnecting = false) => ({ jobId: phase, phase, reconnecting });
        const summary = summarizeImageTasks([
            { id: "queued", status: "pending", startedAt: 100, progress: progress("queued") },
            { id: "submitting", status: "pending", startedAt: 100, progress: progress("submitting") },
            { id: "offline", status: "pending", startedAt: 100, progress: progress("waiting_upstream", true) },
            { id: "generating", status: "pending", startedAt: 100, progress: progress("waiting_upstream") },
            { id: "completed", status: "pending", startedAt: 100, progress: progress("completed") },
            { id: "persisting", status: "pending", startedAt: 100, progress: progress("persisting") },
            { id: "saving", status: "success", image: { id: "image", dataUrl: "test", width: 1, height: 1, durationMs: 1, bytes: 1, persisted: false } },
        ]);
        expect(summary.text).toBe("生成中 1 张 · 排队中 1 张 · 提交中 1 张 · 重新连接中 1 张 · 正在传输并保存图片 1 张 · 生成完成 1 张 · 保存中 1 张");
        expect(summary.settled).toBe(1);
        expect(summary.total).toBe(7);
    });
    it("distinguishes queued, generating and cancellation requests without double counting", () => {
        const summary = summarizeImageTasks([
            { id: "queued", status: "pending" },
            { id: "running", status: "pending", startedAt: 100 },
            { id: "canceling", status: "pending", startedAt: 100, cancelRequested: true },
        ]);
        expect(summary.activeText).toBe("生成中 1 张 · 排队中 1 张 · 取消中 1 张");
        expect(summary.settled).toBe(0);
        expect(summary.total).toBe(3);
    });

    it("keeps failures and cancellations visible when some images succeed", () => {
        const summary = summarizeImageTasks([
            { id: "success", status: "success" },
            { id: "failed", status: "failed" },
            { id: "canceled", status: "canceled", cancelRequested: true },
        ]);
        expect(summary.text).toBe("成功 1 张 · 失败 1 张 · 已取消 1 张");
        expect(summary.activeText).toBe("");
        expect(summary.settled).toBe(3);
    });

    it("does not treat a retry as already finished", () => {
        const summary = summarizeImageTasks([{ id: "success", status: "success" }, { id: "retry", status: "pending" }]);
        expect(summary.text).toBe("排队中 1 张 · 成功 1 张");
        expect(summary.settled).toBe(1);
        expect(summary.total).toBe(2);
    });
});
