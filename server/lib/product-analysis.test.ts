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
    expect(messages.system).toContain("不要把整套视觉规划成纯白背景");
    expect(messages.system).toContain("visualStyleGuide");
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
        subcategory: "马克杯",
        material: "白瓷",
        color: "白色与金色杯沿",
        styleTags: ["简约", "轻奢"],
        targetAudience: "喜欢简约家居的年轻用户",
        usageScenarios: ["居家茶歇", "办公室饮用"],
        titleSuggestion: "简约白瓷茶杯",
        sellingPoints: ["温润白瓷", "金边点缀", "易清洁"],
        differentiationPoints: ["克制金边"],
        userConcerns: ["是否容易清洁"],
        recommendedFocusPoints: ["杯口与瓷面细节"],
        additionalInformation: "杯口、杯体与把手结构需要保持一致，容量未知",
        visualDirection: "克制、明亮、留白充足",
        visualStyleGuide: {
          styleName: "现代家居茶具视觉",
          colorPalette: "白色、金色与低饱和绿色",
          backgroundSystem: "餐桌场景、石材台面与柔和色块交替",
          lighting: "自然窗光",
          cameraLanguage: "主图三分之四视角，详情微距",
          typography: "简洁现代中文",
          layoutRules: "每页一个目标",
          propRules: "仅使用茶具相关道具",
          productRenderingRules: "保持杯型与金边一致",
          negativeStyleConstraints: "禁止整套纯白底",
        },
        complianceNotes: ["不虚构容量"],
        detailSections: Array.from({ length: 12 }, (_, index) => ({
          type: index % 2 ? "scenario" : "material",
          title: `详情 ${index + 1}`,
          objective: "展示商品",
          copy: "温润质感",
          prompt: "保持商品结构和包装文字不变",
          negativeConstraints: ["不要改变金边"],
        })),
      })}\n\`\`\``,
    );

    expect(result.productName).toBe("白瓷茶杯");
    expect(result.sellingPoints).toEqual(["温润白瓷", "金边点缀", "易清洁"]);
    expect(result.material).toBe("白瓷");
    expect(result.visualStyleGuide.backgroundSystem).toContain("餐桌场景");
    expect(result.detailSections).toHaveLength(8);
    expect(result.detailSections[0].type).toBe("material");
    expect(result.detailSections[0].prompt).toContain("保持商品结构");
  });
});
