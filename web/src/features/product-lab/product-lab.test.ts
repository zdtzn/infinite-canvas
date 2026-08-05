import { describe, expect, test } from "bun:test";

import {
    availableProductOutputs,
    buildMultiStyleProductPlan,
    buildProductSuitePlan,
    buildProductVisualPlan,
    emptyProductAnalysis,
    productDetailPageLimit,
    productPlanPresetSelection,
    productPlanVisualControls,
    productRealmExperience,
    reconcileProductPlanSelection,
    resolveProductTemplatePrompt,
    selectedProductOutputKinds,
    toggleProductPlanItemSelection,
    toggleProductPlanKindSelection,
    type ProductAnalysis,
} from "./product-lab";

function analysisFixture(): ProductAnalysis {
    return {
        ...emptyProductAnalysis("白瓷茶杯"),
        category: "茶具",
        subcategory: "马克杯",
        material: "白瓷",
        color: "白色与金色杯沿",
        targetAudience: "年轻家居用户",
        usageScenarios: ["现代餐桌与居家茶歇"],
        titleSuggestion: "简约白瓷茶杯",
        sellingPoints: ["温润白瓷", "金边点缀"],
        differentiationPoints: ["克制金边与圆润杯型"],
        userConcerns: ["杯口是否顺滑", "是否容易清洁"],
        additionalInformation: "杯体、杯口与把手结构需要保持一致，容量未知",
        visualDirection: "现代、清透、有生活空间层次",
        complianceNotes: ["不虚构容量"],
        detailSections: [
            { type: "material", title: "材质细节", objective: "表现瓷面质感", copy: "温润细腻", prompt: "近景展示瓷面和杯口金边", negativeConstraints: ["不要改变金边位置"] },
            { type: "scenario", title: "使用场景", objective: "表现居家使用", copy: "让日常饮用更有质感", prompt: "现代餐桌茶歇场景", negativeConstraints: ["不要使用无关餐具"] },
        ],
    };
}

describe("product lab experience and planning", () => {
    test("uses restrained realm-specific welcomes and a distinct Dou Emperor state", () => {
        expect(productRealmExperience("斗之气").title).toBe("欢迎踏入商品炼制之道。");
        expect(productRealmExperience("斗帝")).toMatchObject({
            title: "恭迎斗帝归来。",
            imperial: true,
            actionLabel: "一念成卷",
        });
    });

    test("expands one product plan into distinct multi-style variants", () => {
        const plan = buildMultiStyleProductPlan({
            analysis: analysisFixture(),
            platform: "pinduoduo",
            styleKeys: ["clean", "premium"],
            brandName: "",
            detailPageLimit: 0,
        });

        expect(plan.filter((item) => item.kind === "main_image")).toHaveLength(2);
        expect(plan.map((item) => item.id)).toEqual(expect.arrayContaining(["clean:main-image", "premium:main-image"]));
        expect(plan.find((item) => item.id === "premium:main-image")?.title).toContain("品质质感");
        expect(plan.find((item) => item.id === "premium:main-image")?.prompt).toContain("品质材质商业视觉");
    });

    test("derives output access from cultivation capabilities and model availability", () => {
        const outputs = availableProductOutputs({
            capabilities: ["product.basic", "product.main_image"],
            imageModelAvailable: true,
            analysisAvailable: false,
        });

        expect(outputs.find((item) => item.kind === "basic_image")?.available).toBe(true);
        expect(outputs.find((item) => item.kind === "main_image")?.available).toBe(true);
        expect(outputs.find((item) => item.kind === "detail_page")?.available).toBe(false);
        expect(
            availableProductOutputs({
                capabilities: ["product.basic"],
                imageModelAvailable: false,
                analysisAvailable: true,
            }).every((item) => !item.available),
        ).toBe(true);
    });

    test("limits detail-page planning by realm without changing cultivation progress", () => {
        expect(productDetailPageLimit("大斗师")).toBe(3);
        expect(productDetailPageLimit("斗灵")).toBe(8);
        expect(productDetailPageLimit("斗帝")).toBe(8);
        expect(productDetailPageLimit("斗师")).toBe(0);
    });

    test("builds varied commercial pages instead of repeating white-background cutouts", () => {
        const plan = buildProductVisualPlan({
            analysis: analysisFixture(),
            platform: "pinduoduo",
            styleKey: "clean",
            brandName: "",
            detailPageLimit: 3,
        });

        expect(plan.find((item) => item.kind === "main_image")?.prompt).toContain("不得输出商品抠图加纯白背景");
        expect(plan.find((item) => item.kind === "scene_image")?.prompt).toContain("现代餐桌与居家茶歇");
        expect(plan.filter((item) => item.kind === "detail_page")).toHaveLength(3);
        expect(new Set(plan.filter((item) => item.kind === "detail_page").map((item) => item.sectionType)).size).toBeGreaterThan(1);
        expect(plan.filter((item) => item.kind !== "basic_image").every((item) => item.prompt.includes("必须替换参考图中的原始白底"))).toBe(true);
        expect(plan.every((item) => item.prompt.includes("统一视觉系统"))).toBe(true);
        expect(plan.every((item) => item.prompt.length <= 18_000)).toBe(true);
    });

    test("fills duplicate AI sections with missing commercial page roles", () => {
        const analysis = analysisFixture();
        analysis.detailSections = [...analysis.detailSections, { ...analysis.detailSections[0], title: "重复材质页" }, { ...analysis.detailSections[1], title: "重复场景页" }];
        const detailTypes = buildProductVisualPlan({
            analysis,
            platform: "pinduoduo",
            styleKey: "clean",
            brandName: "",
            detailPageLimit: 8,
        })
            .filter((item) => item.kind === "detail_page")
            .map((item) => item.sectionType);

        expect(detailTypes).toEqual(["material", "scenario", "selling_points", "detail_closeup", "specs", "comparison", "brand_trust", "summary"]);
    });

    test("selects one main image by default and allows individual detail-page generation", () => {
        const plan = buildProductVisualPlan({
            analysis: analysisFixture(),
            platform: "pinduoduo",
            styleKey: "clean",
            brandName: "",
            detailPageLimit: 3,
        });
        const initial = reconcileProductPlanSelection([], plan);
        const main = plan.find((item) => item.kind === "main_image")!;
        const detailItems = plan.filter((item) => item.kind === "detail_page");

        expect(initial).toEqual([main.id]);
        const oneDetail = toggleProductPlanItemSelection(initial, detailItems[0].id);
        expect(oneDetail).toContain(detailItems[0].id);
        expect(oneDetail).not.toContain(detailItems[1].id);

        const allDetails = toggleProductPlanKindSelection(oneDetail, plan, "detail_page");
        expect(detailItems.every((item) => allDetails.includes(item.id))).toBe(true);
        expect(selectedProductOutputKinds(oneDetail, plan)).toEqual(expect.arrayContaining(["main_image", "detail_page"]));
    });

    test("keeps recommended presets focused on one visual style and a predictable image count", () => {
        const plan = buildMultiStyleProductPlan({
            analysis: analysisFixture(),
            platform: "pinduoduo",
            styleKeys: ["value", "premium"],
            brandName: "",
            detailPageLimit: 3,
        });

        expect(productPlanPresetSelection("single", plan)).toEqual(["value:main-image"]);
        expect(productPlanPresetSelection("essential", plan)).toEqual(["value:main-image", "value:selling-poster", "value:scene-image"]);

        const fullSelection = productPlanPresetSelection("full", plan);
        expect(fullSelection.length).toBe(7);
        expect(fullSelection.every((id) => id.startsWith("value:"))).toBe(true);
    });

    test("shows single-image templates only when the current plan targets one output kind", () => {
        expect(productPlanVisualControls("single", ["main_image"])).toEqual({
            styleLabel: "主图视觉风格",
            styleHint: "选择一张图的主要视觉表达",
            showTemplates: true,
        });
        expect(productPlanVisualControls("essential", ["main_image", "selling_poster", "scene_image"])).toEqual({
            styleLabel: "整套视觉基调",
            styleHint: "统一主图、卖点图与场景图的色彩和质感",
            showTemplates: false,
        });
        expect(productPlanVisualControls("full", ["main_image", "detail_page"])).toMatchObject({
            styleLabel: "整套视觉基调",
            showTemplates: false,
        });
        expect(productPlanVisualControls("custom", ["scene_image"]).showTemplates).toBe(true);
    });

    test("resolves the current product name inside reusable commerce templates", () => {
        expect(resolveProductTemplatePrompt("请为【{{productName}}】设计主图", "坚果礼盒")).toBe("请为【坚果礼盒】设计主图");
        expect(resolveProductTemplatePrompt("商品：{{productName}}", "  ")).toBe("商品：当前商品");
    });
});

describe("product one-click detail suite", () => {
    test("builds one main image plus six ordered detail pages", () => {
        const plan = buildProductSuitePlan({
            analysis: analysisFixture(),
            platform: "pinduoduo",
            styleKey: "value",
            detailPageLimit: 8,
        });

        expect(plan).toHaveLength(7);
        expect(plan[0]).toMatchObject({ kind: "main_image", aspectRatio: "1:1", pageIndex: 0 });
        const details = plan.filter((item) => item.kind === "detail_page");
        expect(details.map((item) => item.sectionType)).toEqual(["selling_points", "scenario", "detail_closeup", "specs", "material", "summary"]);
        expect(details.every((item) => item.aspectRatio === "3:4")).toBe(true);
        expect(details.map((item) => item.pageIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    test("prefers analyzed section content for matching suite slots", () => {
        const plan = buildProductSuitePlan({
            analysis: analysisFixture(),
            platform: "pinduoduo",
            detailPageLimit: 8,
        });

        const material = plan.find((item) => item.sectionType === "material")!;
        expect(material.title).toBe("材质细节");
        expect(material.prompt).toContain("近景展示瓷面和杯口金边");
    });

    test("respects the current realm detail-page limit", () => {
        const limited = buildProductSuitePlan({ analysis: analysisFixture(), platform: "pinduoduo", detailPageLimit: 3 });
        expect(limited).toHaveLength(4);
        expect(limited.filter((item) => item.kind === "detail_page")).toHaveLength(3);

        const none = buildProductSuitePlan({ analysis: analysisFixture(), platform: "pinduoduo", detailPageLimit: 0 });
        expect(none).toHaveLength(1);
        expect(none[0].kind).toBe("main_image");
    });
});
