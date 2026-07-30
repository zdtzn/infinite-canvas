import { expect, test } from "bun:test";

import { generationFailedMessages, generationFailureFeedback, generationFailureKind, generationFailureText } from "./generation-messages";

test("uses a dedicated system vocabulary for upstream and network failures", () => {
    const feedback = generationFailureFeedback("上游服务返回 503，当前渠道暂时不可用", { seed: "system" });

    expect(feedback.kind).toBe("system");
    expect(generationFailedMessages.system).toContainEqual({ title: feedback.title, description: feedback.description });
});

test("uses the Dou Emperor vocabulary regardless of the upstream failure type", () => {
    const feedback = generationFailureFeedback("网络连接超时", { isDouEmperor: true, seed: "imperial" });

    expect(feedback.kind).toBe("imperial");
    expect(generationFailedMessages.imperial).toContainEqual({ title: feedback.title, description: feedback.description });
});

test("keeps ordinary prompt and parameter failures in the common vocabulary", () => {
    expect(generationFailureKind("当前渠道不支持这组生成参数")).toBe("common");

    const first = generationFailureFeedback("当前渠道不支持这组生成参数", { seed: "same-seed" });
    const second = generationFailureFeedback("当前渠道不支持这组生成参数", { seed: "same-seed" });
    expect(first).toEqual(second);
    expect(generationFailureText(first)).not.toContain("生成失败");
});
