import { expect, test } from "bun:test";

import { imageHistorySummary } from "./history-summary";

test("partial success keeps the whole requested group for regeneration", () => {
    expect(imageHistorySummary({ successCount: 2, failCount: 2, imageCount: 4, config: { count: "4" }, status: "成功", images: [{}, {}] })).toEqual({
        outcome: "partial", label: "部分成功 · 2/4张", successCount: 2, failCount: 2, totalCount: 4, retryCount: 4,
    });
});

test("all succeeded and all failed records show their actual result counts", () => {
    expect(imageHistorySummary({ successCount: 4, failCount: 0, imageCount: 4, config: { count: "4" }, status: "成功", images: [{}, {}, {}, {}] })).toMatchObject({ outcome: "success", label: "成功 · 4/4张", retryCount: 4 });
    expect(imageHistorySummary({ successCount: 0, failCount: 4, imageCount: 4, config: { count: "4" }, status: "失败", images: [] })).toMatchObject({ outcome: "failure", label: "失败 · 0/4张", retryCount: 4 });
});

test("missing count fields use existing images and the recorded request size", () => {
    expect(imageHistorySummary({ status: "成功", config: { count: "4" }, images: [{}, {}] })).toMatchObject({ outcome: "partial", label: "部分成功 · 2/4张", retryCount: 4 });
    expect(imageHistorySummary({ status: "成功", images: [{}, {}, {}] })).toMatchObject({ outcome: "success", label: "成功 · 3/3张", retryCount: 3 });
    expect(imageHistorySummary({ status: "成功", imageCount: 2 })).toMatchObject({ outcome: "success", label: "成功 · 2/2张", retryCount: 2 });
    expect(imageHistorySummary({ status: "失败", imageCount: 4 })).toMatchObject({ outcome: "failure", label: "失败 · 0/4张", retryCount: 4 });
});

test("recorded outcomes determine group size when request metadata is missing", () => {
    expect(imageHistorySummary({ successCount: 2, failCount: 2 })).toMatchObject({ label: "部分成功 · 2/4张", retryCount: 4 });
    expect(imageHistorySummary({ failCount: 3, status: "失败" })).toMatchObject({ label: "失败 · 0/3张", retryCount: 3 });
    expect(imageHistorySummary({ status: "失败" })).toMatchObject({ label: "失败 · 0/1张", retryCount: 1 });
});
