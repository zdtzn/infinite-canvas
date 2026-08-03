import { describe, expect, test } from "bun:test";

import {
  ProductAnalysisInputError,
  buildGeminiProductAnalysisBody,
  buildOpenAiProductAnalysisBody,
  buildOpenAiResponsesProductAnalysisBody,
  buildProductAnalysisMessages,
  normalizeProductAnalysisInput,
  normalizeProductAnalysisResult,
} from "./product-analysis";

describe("product image analysis", () => {
  test("accepts only bounded product metadata and a server asset handle", () => {
    expect(
      normalizeProductAnalysisInput({
        assetKey: "image:product-1",
        platform: "pinduoduo",
        styleKey: "clean",
        notes: "  白瓷材质，保留杯口金边  ",
        ignoredDataUrl: "data:image/png;base64,secret",
      }),
    ).toEqual({
      assetKey: "image:product-1",
      platform: "pinduoduo",
      styleKey: "clean",
      notes: "白瓷材质，保留杯口金边",
    });
    expect(() =>
      normalizeProductAnalysisInput({ assetKey: "../other-user.png" }),
    ).toThrow(ProductAnalysisInputError);
  });

  test("builds provider-specific multimodal requests without changing the image", () => {
    const input = normalizeProductAnalysisInput({
      assetKey: "image:product-1",
      platform: "pinduoduo",
      styleKey: "lifestyle",
      notes: "保留包装文字",
    });
    const messages = buildProductAnalysisMessages(input);
    const image = {
      mimeType: "image/png",
      base64: "aGVsbG8=",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    };

    expect(messages.system).toContain("只输出 JSON");
    expect(messages.user).toContain("保留包装文字");
    expect(
      buildOpenAiProductAnalysisBody("text-model", messages, image),
    ).toMatchObject({ model: "text-model", stream: false });
    expect(
      JSON.stringify(
        buildOpenAiResponsesProductAnalysisBody("text-model", messages, image),
      ),
    ).toContain("input_image");
    expect(
      JSON.stringify(buildGeminiProductAnalysisBody(messages, image)),
    ).toContain("inlineData");
  });

  test("normalizes a bounded commercial analysis and detail-page plan", () => {
    const result = normalizeProductAnalysisResult(
      `\n\`\`\`json\n${JSON.stringify({
        productName: "白瓷茶杯",
        category: "茶具",
        targetAudience: "喜欢简约家居的年轻用户",
        titleSuggestion: "简约白瓷茶杯",
        sellingPoints: ["温润白瓷", "金边点缀", "易清洁"],
        visualDirection: "克制、明亮、留白充足",
        complianceNotes: ["不虚构容量"],
        detailSections: Array.from({ length: 12 }, (_, index) => ({
          title: `详情 ${index + 1}`,
          objective: "展示商品",
          prompt: "保持商品结构和包装文字不变",
        })),
      })}\n\`\`\``,
    );

    expect(result.productName).toBe("白瓷茶杯");
    expect(result.sellingPoints).toEqual(["温润白瓷", "金边点缀", "易清洁"]);
    expect(result.detailSections).toHaveLength(8);
    expect(result.detailSections[0].prompt).toContain("保持商品结构");
  });
});
