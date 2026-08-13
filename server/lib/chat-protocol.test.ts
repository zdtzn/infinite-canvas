import { describe, expect, test } from "bun:test";

import {
  buildGeminiChatBody,
  buildOpenAiChatCompletionBody,
  consumeChatStream,
  type ChatStreamState,
} from "./chat-protocol";

describe("chat protocol", () => {
  test("builds multimodal OpenAI and Gemini messages", () => {
    const messages = [
      {
        role: "user" as const,
        content: "这是什么？",
        images: [{ mimeType: "image/png", base64: "AA==" }],
      },
    ];
    const openAi = buildOpenAiChatCompletionBody("gpt-4o", "system", messages);
    const gemini = buildGeminiChatBody("system", messages);

    expect(openAi.messages[1]).toMatchObject({ role: "user" });
    expect(JSON.stringify(openAi)).toContain("data:image/png;base64,AA==");
    expect(JSON.stringify(gemini)).toContain('"inlineData"');
    expect(JSON.stringify(gemini)).toContain('"data":"AA=="');
  });

  test("normalizes Responses stream deltas", () => {
    const state: ChatStreamState = { buffer: "", text: "", completed: false };
    const deltas: string[] = [];
    consumeChatStream(
      "responses",
      state,
      'data: {"type":"response.output_text.delta","delta":"天地"}\n\n',
      (delta) => deltas.push(delta),
    );
    consumeChatStream(
      "responses",
      state,
      'data: {"type":"response.output_text.delta","delta":"有问"}\n\n',
      (delta) => deltas.push(delta),
    );

    expect(state.text).toBe("天地有问");
    expect(deltas).toEqual(["天地", "有问"]);
  });

  test("normalizes Chat Completions and Gemini streams", () => {
    const openAi: ChatStreamState = { buffer: "", text: "", completed: false };
    consumeChatStream(
      "chat-completions",
      openAi,
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
    );
    expect(openAi.text).toBe("answer");

    const gemini: ChatStreamState = { buffer: "", text: "", completed: false };
    consumeChatStream(
      "gemini",
      gemini,
      'data: {"candidates":[{"content":{"parts":[{"text":"回答"}]}}]}\n\n',
    );
    expect(gemini.text).toBe("回答");
  });

  test("marks terminal stream events and upstream failures", () => {
    const openAi: ChatStreamState = { buffer: "", text: "答案", completed: false };
    consumeChatStream(
      "chat-completions",
      openAi,
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    );
    expect(openAi.completed).toBe(true);

    const responses: ChatStreamState = { buffer: "", text: "", completed: false };
    consumeChatStream(
      "responses",
      responses,
      'data: {"type":"response.failed","response":{"error":{"message":"上游拒绝"}}}\n\n',
    );
    expect(responses.completed).toBe(false);
    expect(responses.error).toBe("上游拒绝");

    const done: ChatStreamState = { buffer: "", text: "", completed: false };
    consumeChatStream("chat-completions", done, "data: [DONE]\n\n");
    expect(done.completed).toBe(true);
  });
});
