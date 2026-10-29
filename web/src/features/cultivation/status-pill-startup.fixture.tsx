import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import type { CultivationProfile } from "@/services/server-api";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";
import { ImperialModeProvider } from "./imperial-mode";
import { cultivationProfileQueryKeyFor } from "./queries";
import { CultivationStatusPill } from "./status-pill";

const ordinaryRealm = "realm-dou-qi";
const emperorRealm = "realm-dou-emperor";
const session = (id: string, realmId: string): LocalUser => ({ id, username: id, displayName: id, avatarUrl: "", realmId });
const ordinarySession = session("ordinary-user", ordinaryRealm);
const emperorSession = session("emperor-user", emperorRealm);
const profile: CultivationProfile = {
    userId: ordinarySession.id, displayName: "普通用户", realmId: ordinaryRealm, realmName: "斗之气", stageId: "stage-one", stageName: "一星", stageOrder: 1,
    color: "#66d9bb", iconKey: "Sparkles", animationPreset: "minimal-line", currentXp: 10, totalXp: 20, requiredXp: 100, xpToNext: 90, nextStageName: "二星", pendingStageId: null,
    dailyLimit: 0, dailyLimitOverride: null, unlimited: false, usedToday: 0, reservedToday: 0, remainingToday: 0, paidImages: 23, todaySuccessfulImages: 7,
    proxyQuota: { dailyLimit: 10, dailyLimitOverride: null, unlimited: false, usedToday: 2, reservedToday: 0, remainingToday: 8 },
    maxConcurrency: 2, capabilities: ["model.gpt-image"], totalImages: 12, activeDays: 3, modelUsage: [], publicMessage: "", breakthrough: null,
};
const emperorProfile = { ...profile, userId: emperorSession.id, realmId: emperorRealm, realmName: "斗帝", stageName: "斗帝", unlimited: true, dailyLimit: null, remainingToday: null, paidImages: 0 };

function render(client: QueryClient, user: LocalUser | null) {
    if (user) useUserStore.getState().setSession(user);
    else useUserStore.getState().clearSession();
    // Zustand's server snapshot reads the initial state, unlike browser renders.
    useUserStore.getInitialState().user = user;
    return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><ImperialModeProvider><CultivationStatusPill /></ImperialModeProvider></MemoryRouter></QueryClientProvider>);
}

function expectEmperor(html: string) {
    assert.ok(html.includes("斗帝 · 诸天至尊"));
    assert.ok(html.includes("查看斗帝身份与帝临设置"));
    assert.doesNotMatch(html, /灵卷|今日剩余|今日不限次数/);
}

function expectPendingOrdinary(html: string) {
    assert.ok(html.includes('href="/cultivation"'));
    assert.ok(html.includes("我的修炼"));
    assert.doesNotMatch(html, /斗帝|诸天至尊|imperial-seal|灵卷|今日剩余|今日不限次数/);
}

async function failedProfile(client: QueryClient, user: LocalUser) {
    await client.fetchQuery({ queryKey: cultivationProfileQueryKeyFor(user.id), queryFn: () => Promise.reject(new Error("profile unavailable")), retry: false }).catch(() => undefined);
    assert.equal(client.getQueryState(cultivationProfileQueryKeyFor(user.id))?.status, "error");
}

const scenarios: Array<[string, (client: QueryClient) => void | Promise<void>]> = [
    ["verified emperor appears before the profile response", (client) => {
        expectEmperor(render(client, emperorSession));
        assert.equal(client.getQueryData(cultivationProfileQueryKeyFor(emperorSession.id)), undefined);
    }],
    ["verified emperor stays visible after profile failure without invented quota", async (client) => {
        await failedProfile(client, emperorSession);
        expectEmperor(render(client, emperorSession));
        assert.equal(client.getQueryData(cultivationProfileQueryKeyFor(emperorSession.id)), undefined);
    }],
    ["fresh ordinary profile overrides an emperor session", (client) => {
        client.setQueryData(cultivationProfileQueryKeyFor(emperorSession.id), { ...profile, userId: emperorSession.id });
        const html = render(client, emperorSession);
        assert.ok(html.includes("斗之气 · 一星"));
        assert.ok(html.includes("灵卷 23 张"));
        assert.doesNotMatch(html, /诸天至尊|查看斗帝身份|imperial-seal/);
    }],
    ["fresh emperor profile overrides an ordinary session", (client) => {
        client.setQueryData(cultivationProfileQueryKeyFor(ordinarySession.id), { ...emperorProfile, userId: ordinarySession.id });
        expectEmperor(render(client, ordinarySession));
    }],
    ["ordinary pending profile shows a neutral entry without invented quota", (client) => expectPendingOrdinary(render(client, ordinarySession))],
    ["ordinary failed profile shows a neutral entry without invented quota", async (client) => {
        await failedProfile(client, ordinarySession);
        expectPendingOrdinary(render(client, ordinarySession));
    }],
    ["anonymous users have no identity entry", (client) => assert.equal(render(client, null), "")],
    ["resolved ordinary profile keeps the existing realm and balance", (client) => {
        client.setQueryData(cultivationProfileQueryKeyFor(ordinarySession.id), profile);
        const html = render(client, ordinarySession);
        assert.ok(html.includes("斗之气 · 一星"));
        assert.ok(html.includes("灵卷 23 张"));
        assert.doesNotMatch(html, /诸天至尊|今日剩余 0 次/);
    }],
    ["switching accounts does not reuse the previous emperor profile", (client) => {
        client.setQueryData(cultivationProfileQueryKeyFor(emperorSession.id), emperorProfile);
        expectEmperor(render(client, emperorSession));
        expectPendingOrdinary(render(client, ordinarySession));
        assert.equal(render(client, null), "");
    }],
];

let failures = 0;
for (const [name, check] of scenarios) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
        await check(client);
        console.log(`PASS ${name}`);
    } catch (error) {
        failures++;
        console.error(`FAIL ${name}`, error);
    } finally {
        client.clear();
        useUserStore.getState().clearSession();
    }
}
if (failures) process.exitCode = 1;
else console.log(`${scenarios.length} header identity startup scenarios passed`);
