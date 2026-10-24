import { expect, test } from "bun:test";
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

const emperorProfile: Partial<CultivationProfile> = { realmId: "realm-dou-emperor", realmName: "斗帝", stageName: "斗帝", nextStageName: null, dailyLimit: null, unlimited: true, remainingToday: null, paidImages: 0 };

function renderWithProfile(content: ReactNode, overrides: Partial<CultivationProfile> = {}) {
    const client = new QueryClient();
    for (const userId of ["", "local"]) client.setQueryData(cultivationProfileQueryKeyFor(userId), { ...profile, ...overrides });
    try {
        return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><ImperialModeProvider>{content}</ImperialModeProvider></MemoryRouter></QueryClientProvider>);
    } finally {
        client.clear();
    }
}

test("the ordinary palace shows paid image successes and wallet balance instead of a zero daily allowance", () => {
    const html = renderWithProfile(<CultivationPage />);
    expect(html).toContain("7 张");
    expect(html).toContain("灵卷 23 张");
    expect(html).toContain("升级不赠送每日图片额度");
    expect(html).not.toContain("已使用 0 / 0 次");
    expect(html).not.toContain("剩余 0 次");
});

test("the emperor palace records actual successes and retains unlimited free images", () => {
    const html = renderWithProfile(<CultivationPage />, emperorProfile);
    expect(html).toContain("7<small>张</small>");
    expect(html).toContain("图片生成免费不限次数，无需消耗灵卷");
    expect(html).not.toContain("今日尚未落笔");
    expect(html).not.toContain("每张消耗 1 灵卷");
});

test("navigation distinguishes wallet balance from emperor unlimited creation", () => {
    for (const overrides of [{}, emperorProfile]) {
        const html = renderWithProfile(<CultivationStatusPill />, overrides);
        expect(html).toContain(overrides.unlimited ? "不限次数" : "灵卷 23 张");
        expect(html).not.toContain("今日剩余 0 次");
    }
});

test("image generation describes wallet consumption while video uses its separate remaining allowance", () => {
    const image = renderWithProfile(<ImagePage />);
    expect(image).toContain("本次占用 1 灵卷");
    expect(image).toContain("每张消耗 1 灵卷");
    expect(image).not.toContain("今日剩余 0 次");
    const emperor = renderWithProfile(<ImagePage />, emperorProfile);
    expect(emperor).toContain("今日不限次数");
    expect(emperor).not.toContain("本次占用 1 灵卷");
    const video = renderWithProfile(<VideoPage />);
    expect(video).toContain("其他服务额度 · 今日剩余 8 次");
    expect(video).not.toMatch(/今日剩余 0 次|灵卷不足|今日斗气已经耗尽/);
});
