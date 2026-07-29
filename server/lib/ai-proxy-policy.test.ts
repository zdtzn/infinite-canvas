import { describe, expect, test } from "bun:test";

import { proxyPathModel, proxyRequestKind } from "./ai-proxy-policy";

describe("managed AI proxy policy", () => {
  test("allows only the OpenAI text endpoint needed by the canvas", () => {
    expect(proxyRequestKind("POST", "openai", "/responses")).toBe("text");
    expect(
      proxyRequestKind("POST", "openai", "/images/generations"),
    ).toBeNull();
    expect(proxyRequestKind("POST", "openai", "/chat/completions")).toBeNull();
  });

  test("keeps existing model and media routes available", () => {
    expect(proxyRequestKind("GET", "openai", "/models")).toBe("read");
    expect(proxyRequestKind("POST", "openai", "/audio/speech")).toBe("audio");
    expect(proxyRequestKind("POST", "openai", "/videos")).toBe("video");
  });

  test("allows Gemini text generation and reads its model from the route", () => {
    const path = "/models/gemini-2.5-pro:streamGenerateContent";
    expect(proxyRequestKind("POST", "gemini", path)).toBe("text");
    expect(proxyPathModel("gemini", path)).toBe("gemini-2.5-pro");
    expect(
      proxyRequestKind(
        "POST",
        "gemini",
        "/models/gemini-2.5-pro:batchGenerateContent",
      ),
    ).toBeNull();
  });
});
