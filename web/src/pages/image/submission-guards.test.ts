import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { resolveImageModelSettings } from "@/stores/image-model-settings";
import { defaultConfig } from "@/stores/use-config-store";
import { imageHistorySummary } from "./history-summary";

// Exercise the actual page closures with local dependencies, without loading the page or mocking modules.
const source = ts.createSourceFile("index.tsx", readFileSync(new URL("./index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["buildRequestSnapshot", "retryResult"]);
const snippets: string[] = [];
function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) snippets.push(`const ${node.getText(source)};`);
    ts.forEachChild(node, collect);
}
collect(source);
assert.equal(snippets.length, names.size);
const makeHandlers = new Function("deps", ts.transpileModule(`
    const { createElement, referenceUploadsRef, message, prompt, isAiConfigReady, effectiveConfig,
        model, openConfigDialog, references, activeImageCapabilities, requestImageConfig,
        previewLog, resolveImageModelSettings, imageHistorySummary, modal, cultivationProfile,
        continueFromGenerationLog, setAutoRunToken } = deps;
    ${snippets.join("\n")}
    return { buildRequestSnapshot, retryResult };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React, jsxFactory: "createElement" } }).outputText);

test("reference processing prevents a submission snapshot until uploads finish", () => {
    const referenceUploadsRef = { current: 1 };
    const notices: string[] = [];
    const references = [{ id: "reference", dataUrl: "https://example.test/reference.png" }];
    let readinessChecks = 0;
    const { buildRequestSnapshot } = makeHandlers({
        referenceUploadsRef, message: { warning: (text: string) => notices.push(text), error: assert.fail },
        prompt: "  a landscape  ", effectiveConfig: defaultConfig, model: defaultConfig.imageModel,
        isAiConfigReady: () => { readinessChecks++; return true; }, openConfigDialog: assert.fail,
        references, activeImageCapabilities: { maxReferences: 4 }, requestImageConfig: defaultConfig,
    });

    assert.equal(buildRequestSnapshot(), null);
    assert.deepEqual(notices, ["参考图正在处理中，请稍候"]);
    assert.equal(readinessChecks, 0);
    referenceUploadsRef.current = 0;
    const snapshot = buildRequestSnapshot();
    assert.equal(snapshot.text, "a landscape");
    assert.deepEqual(snapshot.references, references);
    assert.equal(readinessChecks, 1);
});

test("a failed history group retries four images only after confirming its quota use", async () => {
    type Confirmation = { title: string; content: ReactNode; okText: string; cancelText: string; onOk: () => void; onCancel?: () => void };
    const confirmations: Confirmation[] = [];
    const previewLog = { id: "failed-history", model: defaultConfig.imageModel, config: { imageModel: defaultConfig.imageModel, count: "4" }, status: "失败" as const, successCount: 0, failCount: 4, imageCount: 4, images: [] };
    const continued: typeof previewLog[] = [];
    let autoRunToken = 0;
    let autoRuns = 0;
    const { retryResult } = makeHandlers({
        createElement, previewLog, effectiveConfig: defaultConfig, resolveImageModelSettings, imageHistorySummary,
        cultivationProfile: { unlimited: false, dailyLimit: 0 }, modal: { confirm: (options: Confirmation) => confirmations.push(options) },
        continueFromGenerationLog: (log: typeof previewLog) => continued.push(log),
        setAutoRunToken: (update: (value: number) => number) => { autoRuns++; autoRunToken = update(autoRunToken); },
    });

    await retryResult(0);
    assert.equal(confirmations.length, 1);
    const confirmation = confirmations[0];
    assert.equal(confirmation.title, "重新生成 4 张图片？");
    assert.equal(confirmation.okText, "生成 4 张");
    assert.equal(confirmation.cancelText, "取消");
    assert.match(renderToStaticMarkup(confirmation.content), /本次占用 4 灵卷，未生成部分按结算返还/);
    assert.deepEqual(continued, []);
    assert.equal(autoRuns, 0);
    confirmation.onCancel?.();
    assert.deepEqual(continued, []);
    assert.equal(autoRuns, 0);
    confirmation.onOk();
    assert.equal(continued.length, 1);
    assert.equal(continued[0].config.count, "4");
    assert.equal(autoRuns, 1);
    assert.equal(autoRunToken, 1);
});
