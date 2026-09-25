import { describe, expect, it } from "bun:test";
import { summarizeImageTasks } from "./task-summary";

describe("image task summary", () => {
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
