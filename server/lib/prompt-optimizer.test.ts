import { describe, expect, test } from "bun:test";

import {
    PROMPT_OPTIMIZER_INPUT_LIMIT,
    PromptOptimizationInputError,
    buildGeminiPromptOptimizationBody,
    buildImagePromptOptimizationMessages,
    buildOpenAiPromptOptimizationBody,
    buildOpenAiResponsesPromptOptimizationBody,
    cleanOptimizedPrompt,
    extractPromptOptimizationText,
    normalizePromptOptimizationInput,
    resolvePromptOptimizationTarget,
} from "./prompt-optimizer";

describe("image prompt optimizer", () => {
    test("normalizes only bounded metadata and never requires reference images", () => {
        expect(
            normalizePromptOptimizationInput({
                prompt: "  保持参考图1的人物，\n改成雨夜街景  ",
                // Client-selected text targets are intentionally ignored.
                channelId: "text-channel",
                model: "gpt-text",
                context: {
                    imageModel: "gpt-image-2",
                    aspectRatio: "3:4",
                    resolution: "medium",
                    referenceCount: 2,
                    editMode: true,
                    source: "canvas",
                    ignoredImage: "data:image/png;base64,secret",
                },
            }),
        ).toEqual({
            prompt: "保持参考图1的人物，\n改成雨夜街景",
            context: {
                imageModel: "gpt-image-2",
                aspectRatio: "3:4",
                resolution: "medium",
                referenceCount: 2,
                editMode: true,
                source: "canvas",
            },
        });
    });

    test("rejects blank and oversized prompts", () => {
        expect(() =>
            normalizePromptOptimizationInput({
                prompt: " ",
            }),
        ).toThrow(PromptOptimizationInputError);
        expect(() =>
            normalizePromptOptimizationInput({
                prompt: "x".repeat(PROMPT_OPTIMIZER_INPUT_LIMIT + 1),
            }),
        ).toThrow(PromptOptimizationInputError);
    });

    test("resolves the optimizer target only from ordered administrator channels", () => {
        const channels = [
            {
                id: "image-first",
                models: [{ name: "gpt-image-2", capability: "image" }],
            },
            {
                id: "text-primary",
                models: [
                    { name: "text-a", capability: "text" },
                    { name: "text-b", capability: "text" },
                ],
            },
            {
                id: "text-fallback",
                models: [{ name: "text-c", capability: "text" }],
            },
        ];

        expect(resolvePromptOptimizationTarget(channels, { channelId: "text-primary", model: "text-b" })).toEqual({
            channelId: "text-primary",
            model: "text-b",
        });
        expect(resolvePromptOptimizationTarget(channels, { channelId: "text-primary", model: "stale-model" })).toEqual({
            channelId: "text-primary",
            model: "text-a",
        });
        expect(resolvePromptOptimizationTarget(channels, { channelId: "missing", model: "text-c" })).toEqual({
            channelId: "text-primary",
            model: "text-a",
        });
        expect(resolvePromptOptimizationTarget([{ id: "image", models: [{ name: "image-only", capability: "image" }] }])).toBeNull();
    });

    test("keeps photography expertise adaptive instead of applying it globally", () => {
        const messages = buildImagePromptOptimizationMessages({
            prompt: "东方水墨山河",
            context: {
                referenceCount: 0,
                editMode: false,
                source: "workbench",
            },
        });

        expect(messages.system).toContain("摄影或写实需求");
        expect(messages.system).toContain("不强塞具体镜头");
        expect(messages.system).toContain("动漫、插画、国风或东方玄幻");
        expect(messages.system).toContain("逐字保留");
        expect(messages.user).toContain('"rawPrompt": "东方水墨山河"');
    });

    test("builds minimal provider requests", () => {
        const messages = { system: "system", user: "user" };
        expect(buildOpenAiPromptOptimizationBody("text-model", messages)).toEqual({
            model: "text-model",
            messages: [
                { role: "system", content: "system" },
                { role: "user", content: "user" },
            ],
            stream: false,
        });
        expect(buildOpenAiResponsesPromptOptimizationBody("text-model", messages)).toEqual({
            model: "text-model",
            input: [
                { role: "system", content: "system" },
                { role: "user", content: "user" },
            ],
            stream: false,
        });
        expect(buildGeminiPromptOptimizationBody(messages)).toEqual({
            systemInstruction: { parts: [{ text: "system" }] },
            contents: [{ role: "user", parts: [{ text: "user" }] }],
        });
    });

    test("extracts and cleans common provider response shapes", () => {
        expect(
            cleanOptimizedPrompt(
                extractPromptOptimizationText({
                    choices: [
                        {
                            message: {
                                content: "```text\n优化后的画面提示词\n```",
                            },
                        },
                    ],
                }),
            ),
        ).toBe("优化后的画面提示词");
        expect(
            cleanOptimizedPrompt(
                extractPromptOptimizationText({
                    candidates: [{ content: { parts: [{ text: "优化后的提示词：山川云海" }] } }],
                }),
            ),
        ).toBe("山川云海");
        expect(
            cleanOptimizedPrompt(
                extractPromptOptimizationText({
                    output: [
                        {
                            content: [{ type: "output_text", text: '{"optimized":"星河万象"}' }],
                        },
                    ],
                }),
            ),
        ).toBe("星河万象");
        expect(cleanOptimizedPrompt('```json\n{"optimized":"雨夜人像摄影"}\n```')).toBe("雨夜人像摄影");
        expect(cleanOptimizedPrompt("Here is the optimized prompt:\nminimal product photography")).toBe("minimal product photography");
    });
});
