import assert from "node:assert/strict";
import { test } from "node:test";

import { extractApiErrorMessage, friendlyErrorMessage } from "./friendly-error";

test("turns common upstream failures into actionable Chinese messages", () => {
    assert.equal(friendlyErrorMessage("Invalid request"), "当前渠道不支持这组生成参数，请检查模型、尺寸、质量和参考图设置");
    assert.equal(friendlyErrorMessage("Upstream service temporarily unavailable"), "当前渠道或模型暂时不可用，请刷新模型列表或更换渠道后重试");
    assert.equal(friendlyErrorMessage("request timed out"), "上游生成等待超时，任务记录已保留，可在任务中心重试");
    assert.equal(friendlyErrorMessage("content policy violation"), "提示词或参考图触发了渠道内容限制，请调整内容后重试");
    assert.equal(friendlyErrorMessage("图片生成失败：上游服务请求过于频繁，请稍后重试。"), "上游请求过于频繁，请稍后重试");
});

test("preserves useful application errors and handles empty server failures", () => {
    assert.equal(friendlyErrorMessage("今日斗气已经耗尽"), "今日斗气已经耗尽");
    assert.equal(friendlyErrorMessage("", 503), "当前渠道或模型暂时不可用，请刷新模型列表或更换渠道后重试");
    assert.equal(friendlyErrorMessage("上游服务返回 524：<!DOCTYPE html><html><body>timeout</body></html>"), "上游渠道等待生成超时（524），请求可能仍在处理并产生费用，请先到渠道后台确认后再重试");
});

test("preserves request and task references when mapping upstream errors", () => {
    expect(friendlyErrorMessage(Object.assign(new Error("bad gateway"), { requestId: "1234567890abcdef" }))).toContain("请求编号 1234567890ab");
    expect(friendlyErrorMessage("timeout（任务编号 abcdef1234567890）")).toContain("任务编号 abcdef123456");
});

test("extracts nested and serialized upstream messages", () => {
    expect(extractApiErrorMessage({ error: { message: "provider rejected request" } })).toBe("provider rejected request");
    expect(extractApiErrorMessage({ detail: JSON.stringify({ msg: "nested gateway error" }) })).toBe("nested gateway error");
    expect(extractApiErrorMessage(new Error(JSON.stringify({ error: { message: "serialized error" } })))).toBe("serialized error");
    expect(extractApiErrorMessage("<html><body>bad gateway</body></html>")).toBe("上游服务返回了 HTML 错误页面");
    expect(extractApiErrorMessage("上游服务返回 524：<!DOCTYPE html><html><body>timeout</body></html>")).toBe("上游服务返回 524");
});
