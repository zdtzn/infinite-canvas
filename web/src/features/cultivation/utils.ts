export function cultivationProgressPercent(currentXp: number, requiredXp: number, pending: boolean) {
    if (pending) return 100;
    if (requiredXp <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((currentXp / requiredXp) * 100)));
}

export function cultivationStageLabel(realmName: string, stageName: string) {
    return realmName.trim() === stageName.trim() ? realmName : `${realmName} · ${stageName}`;
}

export function quotaText(remaining: number | null, unlimited: boolean) {
    return unlimited || remaining === null ? "今日不限次数" : `今日剩余 ${remaining} 次`;
}

export function requiredCultivationCapabilities(input: { model: string; quality?: string; referenceCount: number; hasMask: boolean }) {
    const keys = new Set<string>();
    const model = input.model.toLowerCase();
    if (input.quality === "high") keys.add("generation.hd");
    if (input.referenceCount > 0) keys.add("generation.references");
    if (input.hasMask) keys.add("generation.inpaint");
    if (model.includes("gpt-image") || model.includes("dall-e") || model.includes("dalle")) keys.add("model.gpt-image");
    if (model.includes("gemini")) keys.add("model.gemini");
    if (model.includes("flux")) keys.add("model.flux");
    return Array.from(keys).sort();
}

const capabilityLabels: Record<string, string> = {
    "generation.hd": "高清生成",
    "generation.inpaint": "局部重绘",
    "generation.outpaint": "扩图",
    "generation.references": "参考图",
    "feature.lora": "LoRA",
    "feature.controlnet": "ControlNet",
    "model.gpt-image": "GPT Image 模型",
    "model.gemini": "Gemini 模型",
    "model.flux": "Flux 模型",
};

export function cultivationCapabilityLabel(key: string) {
    return capabilityLabels[key] || key;
}

export function cultivationAccentColor(color: string) {
    const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!match) return "#38bdf8";
    const hex =
        match[1].length === 3
            ? match[1]
                  .split("")
                  .map((value) => `${value}${value}`)
                  .join("")
            : match[1];
    const [red, green, blue] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((value) => Number.parseInt(value, 16) / 255);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (luminance >= 0.24) return `#${hex}`;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    const saturation = max === 0 ? 0 : delta / max;
    let hue = 210;
    if (delta > 0) {
        if (max === red) hue = 60 * (((green - blue) / delta) % 6);
        else if (max === green) hue = 60 * ((blue - red) / delta + 2);
        else hue = 60 * ((red - green) / delta + 4);
    }
    if (hue < 0) hue += 360;
    return `hsl(${Math.round(hue)} ${Math.max(42, Math.round(saturation * 100))}% 64%)`;
}

export function cultivationGenerationBlockReason(input: { remainingToday: number | null; unlimited: boolean; maxConcurrency: number; capabilities: string[]; requestedCount: number; requiredCapabilities: string[] }) {
    const missing = input.requiredCapabilities.filter((key) => !input.capabilities.includes(key));
    if (missing.length) return `当前境界尚未开放${missing.map(cultivationCapabilityLabel).join("、")}`;
    if (!input.unlimited && input.remainingToday !== null && input.remainingToday < input.requestedCount) {
        return input.remainingToday > 0 ? `今日仅剩 ${input.remainingToday} 次，请减少生成数量` : "今日斗气已经耗尽";
    }
    if (input.requestedCount > input.maxConcurrency) return `当前境界最多同时生成 ${input.maxConcurrency} 张图片`;
    return null;
}
