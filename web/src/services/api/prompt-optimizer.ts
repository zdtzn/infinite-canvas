import { serverRequest } from "../server-api";

export type ImagePromptOptimizationContext = {
    imageModel?: string;
    aspectRatio?: string;
    resolution?: string;
    referenceCount: number;
    editMode: boolean;
    source: "workbench" | "canvas";
};

export function buildPromptOptimizationRequest(prompt: string, context: ImagePromptOptimizationContext) {
    return { prompt, context };
}

export async function optimizeImagePrompt(prompt: string, context: ImagePromptOptimizationContext, signal?: AbortSignal) {
    return serverRequest<{ optimized: string }>("/api/prompt/optimize", {
        method: "POST",
        body: buildPromptOptimizationRequest(prompt, context),
        signal,
        timeoutMs: 70_000,
    });
}
