import { describe, expect, test } from "bun:test";

import { availableProductOutputs, buildMultiStyleProductPlan, buildProductVisualPlan, productDetailPageLimit, productRealmExperience } from "./product-lab";

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
        const analysis = {
            productName: "白瓷茶杯",
            category: "茶具",
            targetAudience: "年轻家居用户",
            titleSuggestion: "简约白瓷茶杯",
            sellingPoints: ["温润白瓷"],
            visualDirection: "克制留白",
            complianceNotes: [],
            detailSections: [],
        };
        const plan = buildMultiStyleProductPlan({
            analysis,
            platform: "pinduoduo",
            styleKeys: ["clean", "premium"],
            brandName: "",
            detailPageLimit: 0,
        });

        expect(plan.filter((item) => item.kind === "main_image")).toHaveLength(2);
        expect(plan.map((item) => item.id)).toEqual(expect.arrayContaining(["clean:main-image", "premium:main-image"]));
        expect(plan.find((item) => item.id === "premium:main-image")?.title).toContain("品质质感");
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

    test("builds an editable visual plan for the supported product outputs", () => {
        const plan = buildProductVisualPlan({
            analysis: {
                productName: "白瓷茶杯",
                category: "茶具",
                targetAudience: "年轻家居用户",
                titleSuggestion: "简约白瓷茶杯",
                sellingPoints: ["温润白瓷", "金边点缀"],
                visualDirection: "克制留白",
                complianceNotes: ["不虚构容量"],
                detailSections: [
                    { title: "材质细节", objective: "表现瓷面质感", prompt: "近景展示瓷面" },
                    { title: "使用场景", objective: "表现居家使用", prompt: "现代餐桌场景" },
                ],
            },
            platform: "pinduoduo",
            styleKey: "clean",
            brandName: "",
            detailPageLimit: 3,
        });

        expect(plan.find((item) => item.kind === "main_image")?.prompt).toContain("白瓷茶杯");
        expect(plan.filter((item) => item.kind === "detail_page")).toHaveLength(3);
        expect(plan.every((item) => item.prompt.includes("保持商品主体结构"))).toBe(true);
    });
});
