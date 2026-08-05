import { expect, test } from "bun:test";

import {
    buildDragonChatImageRequest,
    dragonChatImageUrls,
    dragonImageBaseUrl,
    dragonPromptWithSize,
    isDragonChatImageModel,
} from "./dragon-image";

test("routes documented Dragon image models through the dedicated image host", () => {
    expect(
        dragonImageBaseUrl("https://dragtokens.com/", "gpt-image-2-4k超分"),
    ).toBe("https://draw.dragtokens.com");
    expect(
        dragonImageBaseUrl(
            "https://dragtokens.com/v1",
            "gemini-3.1-flash-image",
        ),
    ).toBe("https://draw.dragtokens.com");
    expect(
        dragonImageBaseUrl("https://api.example.com", "gpt-image-2-4k超分"),
    ).toBe("https://api.example.com");
});

test("adds the documented ratio and pixel hint for Dragon 4K image models", () => {
    expect(
        dragonPromptWithSize(
            "画一座山",
            "9:16",
            "720x1280",
            "gpt-image-2-4k超分",
            "https://dragtokens.com",
        ),
    ).toBe("画一座山\n\n请保持 9:16 构图，并输出 720x1280 尺寸。");
    expect(
        dragonPromptWithSize(
            "画一座山",
            "9:16",
            "720x1280",
            "gpt-image-2",
            "https://dragtokens.com",
        ),
    ).toBe("画一座山");
});

test("recognizes Dragon chat-completions image models and extracts markdown image URLs", () => {
    expect(
        isDragonChatImageModel(
            "https://dragtokens.com",
            "gemini-3.1-flash-image",
        ),
    ).toBe(true);
    expect(
        isDragonChatImageModel(
            "https://api.example.com",
            "gemini-3.1-flash-image",
        ),
    ).toBe(false);
    expect(
        dragonChatImageUrls({
            choices: [
                {
                    message: {
                        content:
                            "已完成\n![result](https://cdn.example.com/result.png)",
                    },
                },
            ],
        }),
    ).toEqual(["https://cdn.example.com/result.png"]);
});

test("builds the Dragon Gemini image request in OpenAI chat-completions format", () => {
    expect(
        buildDragonChatImageRequest({
            model: "gemini-3.1-flash-image",
            prompt: "画一座山",
            size: "9:16",
            references: ["data:image/png;base64,AAAA"],
        }),
    ).toEqual({
        model: "gemini-3.1-flash-image",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "画一座山" },
                    {
                        type: "image_url",
                        image_url: { url: "data:image/png;base64,AAAA" },
                    },
                ],
            },
        ],
        modalities: ["text", "image"],
        image_config: { aspect_ratio: "1:1" },
    });
});
