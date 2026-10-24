import assert from "node:assert/strict";
import { test } from "node:test";

import { extractApiErrorMessage, friendlyErrorMessage, userFacingErrorMessage } from "./friendly-error";

test("user-facing errors keep useful guidance and leave support references to details", () => {
    assert.equal(userFacingErrorMessage(new Error("验证码已过期，请重新获取（请求编号 fixture12345）")), "验证码已过期，请重新获取");
    assert.equal(userFacingErrorMessage("余额不足，请先充值"), "余额不足，请先充值");
    assert.equal(userFacingErrorMessage("请先查看生成进度，原任务仍可能生成和计费（任务编号 fixture12345）"), "请先查看生成进度，原任务仍可能生成和计费");
    assert.equal(userFacingErrorMessage({ error: { message: "文件过大，请选择较小的文件" } }), "文件过大，请选择较小的文件");
    assert.equal(userFacingErrorMessage("生成等待超时（524），仍可能产生费用，请先确认结果"), "生成等待超时，仍可能产生费用，请先确认结果");
});

test("user-facing errors use context instead of exposing implementation failures", () => {
    for (const error of ["Upstream request failed", "Failed to fetch", "读取失败：HTTP 502", "上游服务返回 524", "请求失败（502）", "保存失败：SQLITE_BUSY database is locked", "读取失败：TypeError: Cannot read properties of undefined", "<html><body>Bad Gateway</body></html>", '{"code":"UNKNOWN","reason":"内部异常"}', null]) {
        assert.equal(userFacingErrorMessage(error, "暂时无法读取作品，请稍后再试"), "暂时无法读取作品，请稍后再试");
    }
});

test("turns common upstream failures into actionable Chinese messages", () => {
    assert.equal(friendlyErrorMessage("Upstream request failed（任务编号 fixture12345）"), "当前渠道或模型暂时不可用，请刷新模型列表或更换渠道后重试（任务编号 fixture12345）");
    assert.equal(friendlyErrorMessage("Invalid request"), "当前渠道不支持这组生成参数，请检查模型、尺寸、质量和参考图设置");
    assert.equal(friendlyErrorMessage("Upstream service temporarily unavailable"), "当前渠道或模型暂时不可用，请刷新模型列表或更换渠道后重试");
    assert.equal(friendlyErrorMessage("request timed out"), "上游生成等待超时，任务记录已保留，可在任务中心重试");
    assert.equal(friendlyErrorMessage("content policy violation"), "提示词或参考图触发了渠道内容限制，请调整内容后重试");
    assert.equal(friendlyErrorMessage("图片生成失败：上游服务请求过于频繁，请稍后重试。"), "上游请求过于频繁，请稍后重试");
});

test("explains when an image provider has no compatible account available", () => {
    assert.equal(friendlyErrorMessage("No available compatible accounts"), "当前渠道暂时没有可用的模型账号，请稍后重试或切换其他渠道");
});

test("wallet balance errors do not suggest changing models or waiting for daily free quota", () => {
    for (const detail of ["灵卷余额不足，请先补充灵卷后再生图", "付费生图次数不足", "WALLET_INSUFFICIENT"]) {
        assert.equal(friendlyErrorMessage(detail, 402), "灵卷不足，请联系管理员补充灵卷或减少生成数量");
    }
    assert.equal(friendlyErrorMessage("insufficient quota"), "当前模型可用额度不足，请更换模型或联系管理员");
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
