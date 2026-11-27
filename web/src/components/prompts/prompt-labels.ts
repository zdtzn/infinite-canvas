import type { Prompt } from "@/services/api/prompts";

const mediaLabels = { image: "适用图片", video: "适用视频", general: "通用" };

export function promptDisplayTags(prompt: Prompt) {
    return [...new Set([
        ...prompt.tags,
        mediaLabels[prompt.usage?.media ?? "general"],
        ...(prompt.usage?.requiresReference ? ["需要参考图"] : []),
    ])];
}
