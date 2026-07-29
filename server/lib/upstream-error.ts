export function readUpstreamErrorMessage(payload: unknown) {
    const root = asRecord(payload);
    const data = asRecord(root?.data);
    const error = asRecord(root?.error);
    return firstString(
        error?.message,
        error?.msg,
        typeof root?.error === "string" ? root.error : undefined,
        root?.message,
        root?.msg,
        root?.detail,
        data?.message,
        data?.msg,
        data?.detail,
    );
}

export function readUpstreamNonJsonError(status: number, body: string) {
    const text = body.replace(/\s+/g, " ").trim();
    const isHtml = /<!doctype\s+html|<html\b|<head\b|<body\b/i.test(text);
    if (isHtml && status === 524) return "上游渠道等待生成超时（524），请求可能仍在处理并产生费用，请先到渠道后台确认后再重试";
    if (isHtml && [502, 503, 504].includes(status)) return `上游生图服务暂时不可用（${status}）`;
    if (isHtml) return `上游服务返回了 HTML 错误页面（${status}）`;
    if (!text) return `上游服务返回 ${status}，但响应内容为空`;
    if (status >= 200 && status < 300) return `上游服务返回了无法解析的响应（${status}）`;
    return `上游服务返回 ${status}：${text.slice(0, 200)}`;
}

function asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}
