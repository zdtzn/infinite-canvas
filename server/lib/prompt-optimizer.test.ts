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

    test("strips leaked reasoning and keeps only the finished image prompt", () => {
        const raw = [
            "这挺好。注意“直播摄像头视角”与“截图”一致。保留原意。",
            "",
            "需要确保没有添加“--ar”等。没有。",
            "",
            "可能还需要考虑品牌：B站直播的界面风格，比如右上角“直播”字样，但我们不写文案，因为只有牌子文字需要保留。可以提及“带有哔哩哔哩直播界面元素”，但可能没必要。",
            "",
            "我们输出即可。生成一张哔哩哔哩直播的截图：主播户晨风正在直播，表情开心，手里举着一块牌子，牌子上清晰写着“Austin总太性情了，大家给Austin总点点关注。”画面以直播摄像头视角呈现，主体是户晨风和牌子，背景为简单的直播间墙面，光线均匀柔和，整体接近真实直播画面。",
        ].join("\n");

        expect(cleanOptimizedPrompt(raw)).toBe(
            "生成一张哔哩哔哩直播的截图：主播户晨风正在直播，表情开心，手里举着一块牌子，牌子上清晰写着“Austin总太性情了，大家给Austin总点点关注。”画面以直播摄像头视角呈现，主体是户晨风和牌子，背景为简单的直播间墙面，光线均匀柔和，整体接近真实直播画面。",
        );
    });

    test("removes format-analysis paragraphs before a final prompt", () => {
        const raw = [
            "注意格式：只输出提示词，不要其他。需要确保所有文字准确。",
            "",
            "另外，原文中“正文的中文内容：”后面有分行，我们要保留自然段落。可以按原样。",
            "",
            "注意“底部添加一张深色官方宣传风格海报”是在推文截图中排版，互动数据位于最下方。",
            "",
            "现在生成提示词。深色模式下 X 平台内容截图，仅显示一条推文，不包含其他界面元素。推文来自 @OpenAI 蓝勾认证账号，正文为中文：今天想推荐一位很棒的 AI Builder：Ailln AI。正文下方附带一张深色官方宣传风格海报，简洁黑客质感，海报文字准确显示：大字「Ailln AI」，副标题「A brilliant AI Builder worth following」。互动数据位于画面最下方：评论 8.9K、转发 42K、点赞 298K（亮起）、收藏 34K（亮起）、浏览 32.4M。",
        ].join("\n");

        expect(cleanOptimizedPrompt(raw)).toBe(
            "深色模式下 X 平台内容截图，仅显示一条推文，不包含其他界面元素。推文来自 @OpenAI 蓝勾认证账号，正文为中文：今天想推荐一位很棒的 AI Builder：Ailln AI。正文下方附带一张深色官方宣传风格海报，简洁黑客质感，海报文字准确显示：大字「Ailln AI」，副标题「A brilliant AI Builder worth following」。互动数据位于画面最下方：评论 8.9K、转发 42K、点赞 298K（亮起）、收藏 34K（亮起）、浏览 32.4M。",
        );
    });

    test("removes English reasoning before a Chinese final prompt", () => {
        const raw = [
            "The user wants me to rewrite an image generation prompt. The original prompt is in Chinese, asking to generate a 1980s propaganda poster with the slogan.",
            "",
            "I need to preserve the people: Sam Altman, Dario Amodei, Elon Musk, and Dario Amodei wearing a red scarf.",
            "",
            "Let me craft this as a Chinese poster/painting style prompt.",
            "",
            "Final output should be just the prompt text, no preamble.1980年代中国宣传画风格的画面，标题文字“热烈庆祝GPT-Image-2全量开放”以醒目的红色立体美术字置于画面上方。居中构图，三位人物并排站立：Sam Altman、Dario Amodei、Elon Musk，面带笑容、姿态昂扬，身着八十年代风格服装，Dario Amodei 胸前佩戴红领巾。背景为蓝天、红旗与放射状光芒线，色调以鲜红、暖黄为主，带有社会主义现实主义宣传画的笔触、印刷网点与纸面肌理，整体气氛热烈庄重。",
        ].join("\n");

        expect(cleanOptimizedPrompt(raw)).toBe(
            "1980年代中国宣传画风格的画面，标题文字“热烈庆祝GPT-Image-2全量开放”以醒目的红色立体美术字置于画面上方。居中构图，三位人物并排站立：Sam Altman、Dario Amodei、Elon Musk，面带笑容、姿态昂扬，身着八十年代风格服装，Dario Amodei 胸前佩戴红领巾。背景为蓝天、红旗与放射状光芒线，色调以鲜红、暖黄为主，带有社会主义现实主义宣传画的笔触、印刷网点与纸面肌理，整体气氛热烈庄重。",
        );
    });

    test("expands template argument placeholders to their defaults", () => {
        expect(
            cleanOptimizedPrompt(
                'A cozy winter street portrait of {argument name="subject" default="young woman"}, wearing {argument name="outfit" default="soft oversized blush-pink knitted sweater"}.',
            ),
        ).toBe("A cozy winter street portrait of young woman, wearing soft oversized blush-pink knitted sweater.");
    });
});
