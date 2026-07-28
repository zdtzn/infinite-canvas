import { expect, test } from "bun:test";

import { readUpstreamErrorMessage } from "./upstream-error";

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
