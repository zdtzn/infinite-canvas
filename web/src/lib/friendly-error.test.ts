import assert from "node:assert/strict";
import { test } from "node:test";

import { friendlyErrorMessage } from "./friendly-error";

test("turns common upstream failures into actionable Chinese messages", () => {
    assert.equal(friendlyErrorMessage("Invalid request"), "当前渠道不支持这组生成参数，请检查模型、尺寸、质量和参考图设置");
    assert.equal(friendlyErrorMessage("Upstream service temporarily unavailable"), "上游生图服务暂时不可用，任务记录已保留，请稍后重试");
    assert.equal(friendlyErrorMessage("request timed out"), "上游生成等待超时，任务记录已保留，可在任务中心重试");
    assert.equal(friendlyErrorMessage("content policy violation"), "提示词或参考图触发了渠道内容限制，请调整内容后重试");
});

test("preserves useful application errors and handles empty server failures", () => {
    assert.equal(friendlyErrorMessage("今日斗气已经耗尽"), "今日斗气已经耗尽");
    assert.equal(friendlyErrorMessage("", 503), "上游生图服务暂时不可用，任务记录已保留，请稍后重试");
});
