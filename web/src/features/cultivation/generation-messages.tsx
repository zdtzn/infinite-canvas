export type GenerationFailureKind = "common" | "system" | "imperial";

export type GenerationFailureFeedback = {
    kind: GenerationFailureKind;
    title: string;
    description: string;
};

export type GenerationFailureOptions = {
    isDouEmperor?: boolean;
    seed?: string;
};

type GenerationFailureMessage = Omit<GenerationFailureFeedback, "kind">;

export const generationFailedMessages = {
    common: [
        { title: "此卷未成", description: "天地尚未回应此次创造。" },
        { title: "万象演化受阻", description: "请重新凝聚创作之意。" },
        { title: "灵感未能汇聚", description: "此幅画卷暂未开启。" },
        { title: "天地未允此卷诞生", description: "请再次执笔。" },
        { title: "画卷凝聚未竟", description: "等待下一次创造。" },
        { title: "此次演化归于虚无", description: "新的可能正在等待。" },
        { title: "万物尚未成形", description: "请调整心中所想。" },
        { title: "此方天地尚未稳定", description: "请重新尝试。" },
        { title: "创作之力未能汇聚", description: "画卷暂未显现。" },
        { title: "一念未成形", description: "下一次执笔或许会成功。" },
        { title: "天地有感，万象未生", description: "新的灵感仍在汇聚。" },
        { title: "笔落无痕，此卷未开", description: "等待下一次灵光乍现。" },
        { title: "乾坤未定，画卷暂隐", description: "请再次描绘心中世界。" },
        { title: "万法归寂", description: "等待新的契机。" },
        { title: "天地之门未启", description: "此卷暂存虚空。" },
        { title: "灵境未稳", description: "无法承载此方画卷。" },
        { title: "大道推演中断", description: "画卷未能显现。" },
        { title: "此念虽起，万象未随", description: "请重新凝聚创作方向。" },
        { title: "创作意图解析未完成", description: "天地正在重新演算。" },
        { title: "AI 灵感演化中断", description: "请重新唤醒创作方向。" },
        { title: "创作轨迹未能收束", description: "等待下一次生成。" },
        { title: "想象与现实暂未相连", description: "请重新描绘心中世界。" },
        { title: "灵感节点未稳定", description: "等待新的输入。" },
    ],
    system: [
        { title: "天地演化暂缓", description: "外界灵境尚未稳定，请稍候再次执笔。" },
        { title: "万象推演受阻", description: "创作通路暂未贯通，稍后再试。" },
        { title: "灵境暂不可达", description: "天地正在重新演算，请稍候。" },
        { title: "创作之门暂闭", description: "外界法则波动未止，稍后可再次开启。" },
        { title: "此方天地回应迟缓", description: "请稍候片刻，再续此卷。" },
        { title: "万象尚在重整", description: "创作通路恢复后可再次执笔。" },
        { title: "画卷暂未承载", description: "外界灵境波动中，请稍后重试。" },
        { title: "天地回响未至", description: "请保留灵感，待通路稳定后再试。" },
    ],
    imperial: [
        { title: "帝念降临，万象未应", description: "天地规则正在重新演化。" },
        { title: "一念化万象，此卷尚缺契机", description: "新的法则正在重构。" },
        { title: "帝境推演未成", description: "天地仍在回应这一笔。" },
        { title: "天地规则未认可此次创造", description: "等待下一次执笔。" },
        { title: "帝境之笔落下，虚空未现其形", description: "万象仍待凝聚。" },
        { title: "万界未能承载此念", description: "请再次创造。" },
        { title: "诸天法则暂隐", description: "此卷仍在虚空中推演。" },
        { title: "星河未及落墨", description: "下一笔自会唤醒万象。" },
        { title: "帝意已至，天地未合", description: "静待规则重新归位。" },
        { title: "万法尚未响应", description: "诸界正在为下一次创造让路。" },
    ],
} as const satisfies Record<GenerationFailureKind, readonly GenerationFailureMessage[]>;

const SYSTEM_FAILURE_PATTERN = /(上游|服务暂时|暂时不可用|网络|连接|超时|限流|频繁|gateway|timeout|network|connection|rate limit|api\s*key|身份验证|认证|5\d{2}|html\s*错误)/i;

export function generationFailureKind(error: unknown, { isDouEmperor = false }: GenerationFailureOptions = {}): GenerationFailureKind {
    if (isDouEmperor) return "imperial";
    const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return SYSTEM_FAILURE_PATTERN.test(detail) ? "system" : "common";
}

export function generationFailureFeedback(error: unknown, options: GenerationFailureOptions = {}): GenerationFailureFeedback {
    const kind = generationFailureKind(error, options);
    const messages = generationFailedMessages[kind];
    const message = messages[messageIndex(messages.length, options.seed)] || messages[0];
    return { kind, ...message };
}

export function generationFailureText(feedback: GenerationFailureFeedback) {
    return `${feedback.title} ${feedback.description}`;
}

export function GenerationFailureToast({ feedback, supplementary }: { feedback: GenerationFailureFeedback; supplementary?: string }) {
    return (
        <span className="flex max-w-[300px] flex-col text-left leading-5">
            <strong className="font-medium">{feedback.title}</strong>
            <span className="text-xs opacity-80">{feedback.description}</span>
            {supplementary ? <span className="text-xs opacity-70">{supplementary}</span> : null}
        </span>
    );
}

function messageIndex(length: number, seed?: string) {
    if (length < 2) return 0;
    if (!seed) return Math.floor(Math.random() * length);

    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    return hash % length;
}
