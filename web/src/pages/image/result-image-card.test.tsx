import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResultImageCard } from "./result-image-card";

const temporaryImage = {
    id: "temporary-image",
    serverJobId: "job-a",
    dataUrl: "https://img.uuapi.net/result.png",
    durationMs: 42_000,
    width: 1024,
    height: 1024,
    bytes: 0,
    mimeType: "image/png",
    persisted: false,
};

test("keeps automatic original saving invisible to the user", () => {
    const html = renderToStaticMarkup(
        createElement(ResultImageCard, {
            image: temporaryImage,
            index: 0,
            savingAsset: false,
            onContinue: () => undefined,
            onDownload: () => undefined,
            onSaveAsset: () => undefined,
        }),
    );

    assert.doesNotMatch(html, /自动保存原图/);
    assert.doesNotMatch(html, /原图保存中/);
    assert.doesNotMatch(html, /恢复归档/);
    assert.match(html, /入藏卷阁/);
    assert.match(html, /继续创作/);
    assert.match(html, /disabled/);
});

test("keeps the normal result card unchanged after the server file is persisted", () => {
    const html = renderToStaticMarkup(
        createElement(ResultImageCard, {
            image: { ...temporaryImage, dataUrl: "/api/job-files/job-a/result.png", bytes: 1234, persisted: true },
            index: 0,
            savingAsset: false,
            onContinue: () => undefined,
            onDownload: () => undefined,
            onSaveAsset: () => undefined,
        }),
    );

    assert.doesNotMatch(html, /自动保存原图/);
    assert.doesNotMatch(html, /原图保存中/);
    assert.doesNotMatch(html, /恢复归档/);
    assert.match(html, /继续创作/);
});
