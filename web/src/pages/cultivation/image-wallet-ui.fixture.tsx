import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { ImperialModeProvider } from "@/features/cultivation/imperial-mode";
import { cultivationProfileQueryKeyFor } from "@/features/cultivation/queries";
import { CultivationStatusPill } from "@/features/cultivation/status-pill";
import type { CultivationProfile } from "@/services/server-api";
import ImagePage from "@/pages/image";
import VideoPage from "@/pages/video";
import CultivationPage from "./index";

const profile: CultivationProfile = {
    userId: "wallet-user", displayName: "灵卷用户", realmId: "realm-dou-qi", realmName: "斗之气", stageId: "stage-one", stageName: "一星", stageOrder: 1,
    color: "#66d9bb", iconKey: "Sparkles", animationPreset: "minimal-line", currentXp: 10, totalXp: 20, requiredXp: 100, xpToNext: 90, nextStageName: "二星", pendingStageId: null,
    dailyLimit: 0, dailyLimitOverride: null, unlimited: false, usedToday: 0, reservedToday: 0, remainingToday: 0, paidImages: 23, todaySuccessfulImages: 7,
    proxyQuota: { dailyLimit: 10, dailyLimitOverride: null, unlimited: false, usedToday: 2, reservedToday: 0, remainingToday: 8 },
    maxConcurrency: 2, capabilities: ["model.gpt-image"], totalImages: 12, activeDays: 3, modelUsage: [], publicMessage: "", breakthrough: null,
};

const emperorProfile: Partial<CultivationProfile> = { realmId: "realm-dou-emperor", realmName: "斗帝", stageName: "斗帝", nextStageName: null, dailyLimit: null, unlimited: true, remainingToday: null, paidImages: 0, usedToday: 7, todaySuccessfulImages: 7 };

function renderWithProfile(content: ReactNode, overrides: Partial<CultivationProfile> = {}) {
    const client = new QueryClient();
    for (const userId of ["", "local"]) client.setQueryData(cultivationProfileQueryKeyFor(userId), { ...profile, ...overrides });
    try {
        return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><ImperialModeProvider>{content}</ImperialModeProvider></MemoryRouter></QueryClientProvider>);
    } finally {
        client.clear();
    }
}

// Render production components in a fresh process, outside the suite's module mocks.
{
    const html = renderWithProfile(<CultivationPage />);
    assert.ok(html.includes("7 张"));
    assert.ok(html.includes("灵卷 23 张"));
    assert.ok(html.includes("升级不赠送每日图片额度"));
    assert.ok(!html.includes("已使用 0 / 0 次"));
    assert.ok(!html.includes("剩余 0 次"));
}

{
    const html = renderWithProfile(<CultivationPage />, emperorProfile);
    assert.ok(html.includes("7<small>次</small>"));
    assert.ok(html.includes("今日落笔，已留新篇。"));
    assert.ok(!html.includes("今日尚未落笔"));
    assert.doesNotMatch(html, /图片生成免费不限次数|每张消耗 1 灵卷/);
}

{
    const ordinary = renderWithProfile(<CultivationStatusPill />);
    assert.ok(ordinary.includes("灵卷 23 张"));
    assert.ok(!ordinary.includes("今日剩余 0 次"));
    const emperor = renderWithProfile(<CultivationStatusPill />, emperorProfile);
    assert.ok(emperor.includes("斗帝 · 诸天至尊"));
    assert.ok(emperor.includes("查看斗帝身份与帝临设置"));
    assert.doesNotMatch(emperor, /灵卷|不限次数|title=/);
}

{
    const image = renderWithProfile(<ImagePage />);
    assert.ok(image.includes("本次占用 1 灵卷"));
    assert.ok(image.includes("每张消耗 1 灵卷"));
    assert.ok(!image.includes("今日剩余 0 次"));
    const emperor = renderWithProfile(<ImagePage />, emperorProfile);
    assert.ok(emperor.includes("今日不限次数"));
    assert.ok(!emperor.includes("本次占用 1 灵卷"));
    const video = renderWithProfile(<VideoPage />);
    assert.ok(video.includes("其他服务额度 · 今日剩余 8 次"));
    assert.doesNotMatch(video, /今日剩余 0 次|灵卷不足|今日斗气已经耗尽/);
}

console.log("4 image wallet UI SSR scenarios passed");
