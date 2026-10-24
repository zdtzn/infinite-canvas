const MAX_ERROR_LENGTH = 300;

export function userFacingErrorMessage(value: unknown, fallback = "操作未完成，请稍后再试") {
    const message = extractApiErrorMessage(value)
        .replace(/[（(](?:请求|任务)编号\s*[A-Za-z0-9_-]+[）)]/g, "")
        .replace(/(?:请求|任务)编号\s*[A-Za-z0-9_-]+/g, "")
        .replace(/[（(](?:HTTP\s*)?[45]\d{2}[）)]/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!/[\u3400-\u9fff]/.test(message) || /(?:\bHTTP\s*\d{3}|上游服务返回\s*\d{3}|^请求失败$|\bHTML\b|\b(?:Type|Reference|Syntax|Range)Error\b|\bSQLITE_\w+|Unexpected token|\bat\s+\S+\s*\(|^[{\[])/i.test(message)) return fallback;
    return message.slice(0, MAX_ERROR_LENGTH);
}

export function friendlyErrorMessage(value: unknown, status?: number) {
    const raw = extractApiErrorMessage(value).replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);
    const normalized = raw.toLowerCase();
    const supportReference = extractSupportReference(value);
    const withSupportReference = (message: string) => (supportReference && !message.includes(supportReference) ? `${message}（${supportReference}）` : message);

    if (/(灵卷.*不足|付费生图次数不足|WALLET_INSUFFICIENT)/i.test(raw)) {
        return withSupportReference("灵卷不足，请联系管理员补充灵卷或减少生成数量");
    }

    if (/(content policy|safety|moderation|blocked prompt|content_filter)/i.test(raw)) {
        return withSupportReference("提示词或参考图触发了渠道内容限制，请调整内容后重试");
    }
    if (/上游服务返回\s*524/i.test(raw) || status === 524) {
        return withSupportReference("上游渠道等待生成超时（524），请求可能仍在处理并产生费用，请先到渠道后台确认后再重试");
    }
    if (/(invalid request|invalid_request|bad request|unsupported parameter|unknown parameter)/i.test(raw)) {
        return withSupportReference("当前渠道不支持这组生成参数，请检查模型、尺寸、质量和参考图设置");
    }
    if (/(?:no|without) available compatible accounts?|no compatible accounts?/i.test(raw)) {
        return withSupportReference("当前渠道暂时没有可用的模型账号，请稍后重试或切换其他渠道");
    }
    if (/(timeout|timed out|deadline exceeded)/i.test(raw) || status === 504) {
        return withSupportReference("上游生成等待超时，任务记录已保留，可在任务中心重试");
    }
    if (/(upstream request failed|upstream service temporarily unavailable|service unavailable|bad gateway|overloaded)/i.test(raw) || [502, 503, 524].includes(status || 0)) {
        return withSupportReference("当前渠道或模型暂时不可用，请刷新模型列表或更换渠道后重试");
    }
    if (/(quota exceeded|insufficient quota|余额不足|额度不足|配额.*(?:不足|耗尽))/i.test(raw)) {
        return withSupportReference("当前模型可用额度不足，请更换模型或联系管理员");
    }
    if (/(rate limit|too many requests|请求过于频繁|访问过于频繁|频率限制|限流)/i.test(raw) || status === 429) {
        return withSupportReference("上游请求过于频繁，请稍后重试");
    }
    if (/(invalid api key|incorrect api key|authentication failed|unauthorized)/i.test(raw)) {
        return withSupportReference("身份验证失败，请重新登录或检查渠道 API Key");
    }
    if (/(failed to fetch|network error|connection refused|connection reset|dns)/i.test(raw)) {
        return withSupportReference("无法连接当前 AI 渠道，请检查渠道地址和网络后重试");
    }
    if (raw) return withSupportReference(raw);
    if (status && status >= 500) return withSupportReference("服务暂时不可用，请稍后重试");
    return withSupportReference(status ? `请求失败（${status}）` : "操作失败，请稍后重试");
}

function extractSupportReference(value: unknown) {
    if (value && typeof value === "object") {
        const record = value as { requestId?: unknown; jobId?: unknown };
        const requestId = String(record.requestId || "").trim();
        if (requestId) return `请求编号 ${requestId.slice(0, 12)}`;
        const jobId = String(record.jobId || "").trim();
        if (jobId) return `任务编号 ${jobId.slice(0, 12)}`;
    }
    const text = value instanceof Error ? value.message : typeof value === "string" ? value : "";
    const match = text.match(/(请求|任务)编号\s*([A-Za-z0-9_-]{6,128})/);
    return match ? `${match[1]}编号 ${match[2].slice(0, 12)}` : "";
}

export function extractApiErrorMessage(value: unknown, depth = 0): string {
    if (depth > 5 || value === null || value === undefined) return "";
    if (value instanceof Error) return extractApiErrorMessage(value.message, depth + 1);
    if (typeof value === "string") {
        const text = value.trim();
        if (!text) return "";
        try {
            const parsed = JSON.parse(text);
            return extractApiErrorMessage(parsed, depth + 1) || text;
        } catch {
            if (!/<[a-z!][\s\S]*>/i.test(text)) return text;
            const statusMatch = text.match(/上游服务返回\s*(\d{3})/i);
            return statusMatch ? `上游服务返回 ${statusMatch[1]}` : "上游服务返回了 HTML 错误页面";
        }
    }
    if (typeof value === "object") {
        const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
        return extractApiErrorMessage(payload.msg, depth + 1) || extractApiErrorMessage(payload.message, depth + 1) || extractApiErrorMessage(payload.error, depth + 1) || extractApiErrorMessage(payload.detail, depth + 1);
    }
    return "";
}
