const MAX_ERROR_LENGTH = 300;

export function friendlyErrorMessage(value: unknown, status?: number) {
    const raw = errorText(value).replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);
    const normalized = raw.toLowerCase();

    if (/(content policy|safety|moderation|blocked prompt|content_filter)/i.test(raw)) {
        return "提示词或参考图触发了渠道内容限制，请调整内容后重试";
    }
    if (/(invalid request|invalid_request|bad request|unsupported parameter|unknown parameter)/i.test(raw)) {
        return "当前渠道不支持这组生成参数，请检查模型、尺寸、质量和参考图设置";
    }
    if (/(upstream service temporarily unavailable|service unavailable|bad gateway|gateway timeout|overloaded)/i.test(raw) || [502, 503, 504, 524].includes(status || 0)) {
        return "上游生图服务暂时不可用，任务记录已保留，请稍后重试";
    }
    if (/(timeout|timed out|deadline exceeded)/i.test(raw)) {
        return "上游生成等待超时，任务记录已保留，可在任务中心重试";
    }
    if (/(rate limit|too many requests|quota exceeded|insufficient quota)/i.test(raw) || status === 429) {
        return "渠道请求过于频繁或额度不足，请稍后重试";
    }
    if (/(invalid api key|incorrect api key|authentication failed|unauthorized)/i.test(raw)) {
        return "身份验证失败，请重新登录或检查渠道 API Key";
    }
    if (/(failed to fetch|network error|connection refused|connection reset|dns)/i.test(raw)) {
        return "无法连接生图渠道，请检查渠道地址和网络后重试";
    }
    if (raw) return raw;
    if (status && status >= 500) return "服务暂时不可用，请稍后重试";
    return status ? `请求失败（${status}）` : "操作失败，请稍后重试";
}

function errorText(value: unknown) {
    if (value instanceof Error) return value.message;
    if (typeof value === "string") return value;
    return "";
}
