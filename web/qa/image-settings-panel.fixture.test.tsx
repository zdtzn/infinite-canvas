import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { createModelChannel, defaultConfig, encodeChannelModel, type AiConfig } from "@/stores/use-config-store";

function configFor(baseUrl = "https://provider.invalid", modelName = "gpt-image-2", overrides: Partial<AiConfig> = {}) {
    const channel = createModelChannel({ id: "fixture", baseUrl, models: [{ name: modelName, capability: "image" }] });
    const model = encodeChannelModel(channel.id, modelName);
    return { ...defaultConfig, channels: [channel], model, imageModel: model, ...overrides };
}

function render(config: AiConfig, section?: "all" | "basic" | "advanced") {
    return renderToStaticMarkup(<ImageSettingsPanel config={config} selectedModel={config.imageModel} theme={canvasThemes.light} section={section} showTitle={false} onConfigChange={() => undefined} />);
}

test("basic settings expose the three frequent controls without a wall of ratio buttons", () => {
    const config = configFor();
    const basic = render(config, "basic");
    const advanced = render(config, "advanced");
    for (const label of ["构图比例", "输出分辨率", "生成张数"]) {
        expect(basic).toContain(label);
        expect(advanced).not.toContain(label);
    }
    for (const label of ["生成质量", "输出格式", "图片尺寸", "透明背景"]) {
        expect(advanced).toContain(label);
        expect(basic).not.toContain(label);
    }
    expect(basic).toContain('role="combobox"');
    expect(basic).not.toContain("h-14");
    expect(render(config)).toBe(render(config, "all"));
    expect(render(config)).toContain("h-14");
});

test("UU sections retain supported ratio and output count limits with automatic quality", () => {
    const config = configFor("https://uuapi.net/v1", "gpt-image-2", { size: "9:16", count: "4" });
    const basic = render(config, "basic");
    const advanced = render(config, "advanced");
    expect(basic).toContain("标准竖图 (3:4)");
    expect(basic).not.toContain("9:16");
    expect(basic).toMatch(/max="1"[^>]*value="1"/);
    expect(advanced).toContain("当前模型自动决定图片质量");
    expect(advanced).toMatch(/>W<\/span><input[^>]*disabled=""/);
});

test("SADAI advanced settings retain model-defined pixels and disabled transparency", () => {
    const config = configFor("https://api.sadai.top/v1", "gpt-image-2", { size: "2:3", background: "transparent" });
    expect(render(config, "basic")).toContain("海报 (2:3)");
    const advanced = render(config, "advanced");
    expect(advanced).toContain("最终像素由模型决定");
    expect(advanced).not.toContain('type="number"');
    expect(advanced).toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
});

test("custom dimensions stay visible in basic selection and editable in advanced settings", () => {
    const config = configFor("https://provider.invalid", "gpt-image-2", { size: "1408x1056" });
    expect(render(config, "basic")).toContain("自定义 1408x1056");
    const advanced = render(config, "advanced");
    expect(advanced).toContain("自定义尺寸会覆盖比例和分辨率");
    expect(advanced).toMatch(/>W<\/span><input[^>]*value="1408"/);
    expect(advanced).toMatch(/>H<\/span><input[^>]*value="1056"/);
});
