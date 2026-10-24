import { expect, test } from "bun:test";

import { generationFailedMessages, generationFailureFeedback, generationFailureKind, generationFailureText } from "./generation-messages";
import { friendlyErrorMessage } from "@/lib/friendly-error";

test("uses a dedicated system vocabulary for upstream and network failures", () => {
    const feedback = generationFailureFeedback("上游服务返回 503，当前渠道暂时不可用", { seed: "system" });

    expect(feedback.kind).toBe("system");
    expect(generationFailedMessages.system.map((item) => item.title)).toContain(feedback.title);
    expect(feedback.description).toContain("再试");
    expect(feedback.description).not.toMatch(/系统|上游|自动重新提交/);
});

test("uses the Dou Emperor vocabulary regardless of the upstream failure type", () => {
    const feedback = generationFailureFeedback("网络连接超时", { isDouEmperor: true, seed: "imperial" });

    expect(feedback.kind).toBe("imperial");
    expect(generationFailedMessages.imperial.map((item) => item.title)).toContain(feedback.title);
    expect(feedback.description).toContain("确认结果");
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

test("image wallet exhaustion keeps useful advice in ordinary and emperor feedback", () => {
    for (const isDouEmperor of [false, true]) {
        const feedback = generationFailureFeedback(friendlyErrorMessage("灵卷余额不足，请先补充灵卷后再生图", 402), { isDouEmperor });
        expect(feedback.description).toContain("灵卷不足");
        expect(feedback.description).not.toMatch(/换一个模型|明日|每日/);
    }
});

test("preserves a support reference for details without exposing it in the default feedback", () => {
    const feedback = generationFailureFeedback("上游暂时不可用（请求编号 1234567890abcdef）", { seed: "support" });

    expect(feedback.kind).toBe("system");
    expect(feedback.reference).toBe("请求编号 1234567890ab");
    expect(generationFailureText(feedback)).not.toContain("请求编号");
});

test("already translated failures keep actionable guidance and uncertain results are not called refunded", () => {
    expect(generationFailureFeedback("提示词或参考图触发了渠道内容限制，请调整内容后重试").description).toContain("调整");
    expect(generationFailureFeedback("当前渠道不支持这组生成参数，请检查模型、尺寸、质量和参考图设置").description).toContain("尺寸");
    expect(generationFailureFeedback("身份验证失败，请重新登录或检查渠道 API Key").description).not.toMatch(/凭证|API|认证|登录/);
    expect(generationFailureFeedback("insufficient quota").description).toContain("额度");
    expect(generationFailureFeedback(friendlyErrorMessage("insufficient quota")).description).toContain("额度");
    expect(generationFailureFeedback(friendlyErrorMessage("gateway timeout")).description).toContain("确认结果");
    expect(generationFailureFeedback(friendlyErrorMessage("", 504)).description).toContain("确认结果");
    for (const error of ["timeout", "上游渠道等待生成超时（524），请求可能仍在处理并产生费用", "无法连接当前 AI 渠道，请检查渠道地址和网络后重试"]) {
        const feedback = generationFailureFeedback(error);
        expect(feedback.description).toContain("确认结果");
        expect(feedback.description).not.toMatch(/未扣费|已退|自动重新提交/);
    }
});
