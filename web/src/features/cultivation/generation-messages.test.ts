import { expect, test } from "bun:test";

import { generationFailedMessages, generationFailureFeedback, generationFailureKind, generationFailureText } from "./generation-messages";

test("uses a dedicated system vocabulary for upstream and network failures", () => {
    const feedback = generationFailureFeedback("上游服务返回 503，当前渠道暂时不可用", { seed: "system" });

    expect(feedback.kind).toBe("system");
    expect(generationFailedMessages.system.map((item) => item.title)).toContain(feedback.title);
    expect(feedback.description).toContain("本次生成未完成");
});

test("uses the Dou Emperor vocabulary regardless of the upstream failure type", () => {
    const feedback = generationFailureFeedback("网络连接超时", { isDouEmperor: true, seed: "imperial" });

    expect(feedback.kind).toBe("imperial");
    expect(generationFailedMessages.imperial.map((item) => item.title)).toContain(feedback.title);
    expect(feedback.description).not.toMatch(/仍在|正在/);
});

test("policy rejection gives actionable feedback even for emperor users", () => {
    const feedback = generationFailureFeedback("content policy rejected", { isDouEmperor: true });
    expect(feedback.description).toContain("调整提示词或参考图");
    expect(feedback.description).not.toContain("推演");
});

test("keeps ordinary prompt and parameter failures in the common vocabulary", () => {
    expect(generationFailureKind("当前渠道不支持这组生成参数")).toBe("common");

    const first = generationFailureFeedback("当前渠道不支持这组生成参数", { seed: "same-seed" });
    const second = generationFailureFeedback("当前渠道不支持这组生成参数", { seed: "same-seed" });
    expect(first).toEqual(second);
    expect(generationFailureText(first)).not.toContain("生成失败");
});

test("keeps a short support reference without replacing the world-building message", () => {
    const feedback = generationFailureFeedback("上游暂时不可用（请求编号 1234567890abcdef）", { seed: "support" });

    expect(feedback.kind).toBe("system");
    expect(feedback.reference).toBe("请求编号 1234567890ab");
    expect(generationFailureText(feedback)).toContain("请求编号 1234567890ab");
});
