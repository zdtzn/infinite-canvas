import { describe, expect, test } from "bun:test";

import { chatCompletionPayloadText, consumeChatCompletionStreamText, openAiTextEndpoint, type ChatCompletionStreamState } from "./openai-text-protocol";

describe("OpenAI-compatible text protocol", () => {
    test("uses Responses for plain text messages", () => {
        expect(openAiTextEndpoint([{ role: "user", content: "describe this scene" }])).toBe("/responses");
    });

    test("uses Chat Completions when a message contains an image", () => {
        expect(
            openAiTextEndpoint([
                {
                    role: "user",
                    content: [
                        { type: "text", text: "describe this image" },
                        { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
                    ],
                },
            ]),
        ).toBe("/chat/completions");
    });

    test("accumulates Chat Completions SSE deltas", () => {
        const state: ChatCompletionStreamState = { buffer: "", text: "" };
        const updates: string[] = [];

        consumeChatCompletionStreamText(state, 'data: {"choices":[{"delta":{"content":"image"}}]}\n\n', (text) => updates.push(text));
        consumeChatCompletionStreamText(state, 'data: {"choices":[{"delta":{"content":" found"}}]}\n\ndata: [DONE]\n\n', (text) => updates.push(text));

        expect(state.text).toBe("image found");
        expect(updates).toEqual(["image", "image found"]);
        expect(state.error).toBeUndefined();
    });

    test("reads non-streaming Chat Completions content", () => {
        expect(chatCompletionPayloadText({ choices: [{ message: { content: "done" } }] })).toBe("done");
    });
});
