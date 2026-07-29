import { expect, test } from "bun:test";

import { readUpstreamErrorMessage, readUpstreamNonJsonError } from "./upstream-error";

test("reads top-level messages returned by upstream gateways", () => {
    expect(
        readUpstreamErrorMessage({
            code: 400,
            message: "总像素数必须在 655,360 到 8,294,400 之间",
        }),
    ).toBe("总像素数必须在 655,360 到 8,294,400 之间");
});

test("reads nested and string upstream errors", () => {
    expect(readUpstreamErrorMessage({ error: { message: "请求参数无效" } })).toBe("请求参数无效");
    expect(readUpstreamErrorMessage({ error: "渠道暂不可用" })).toBe("渠道暂不可用");
    expect(readUpstreamErrorMessage({ data: { msg: "模型不可用" } })).toBe("模型不可用");
});

test("turns HTML gateway failures into status-aware messages", () => {
    expect(readUpstreamNonJsonError(524, "<!DOCTYPE html><html><body>timeout</body></html>")).toBe("上游渠道等待生成超时（524），请求可能仍在处理并产生费用，请先到渠道后台确认后再重试");
    expect(readUpstreamNonJsonError(502, "<html><body>bad gateway</body></html>")).toBe("上游生图服务暂时不可用（502）");
    expect(readUpstreamNonJsonError(400, "plain error")).toBe("上游服务返回 400：plain error");
});
