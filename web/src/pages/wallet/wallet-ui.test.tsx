import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { cultivationProfileQueryKeyFor } from "@/features/cultivation/queries";
import type { WalletLedgerItem, WalletOverview } from "@/services/server-api";
import WalletPage from "./index";
import { WalletRecordSource } from "./wallet-record-source";
import { walletBalance, walletLedgerLabels, walletQueryOptions, walletRecordSource, walletResourceStatus, walletUnitPrice } from "./wallet-ui";

const packages = [
    { id: "qiling", name: "启灵卷", priceFen: 600, images: 40 },
    { id: "juling", name: "聚灵卷", priceFen: 1500, images: 100 },
    { id: "wanxiang", name: "万象卷", priceFen: 4500, images: 300 },
];
const record: WalletLedgerItem = { id: "record-1", delta: -1, balanceAfter: 39, kind: "reserve", sourceId: "12345678-abcd-4321-1234-123456789abc", packageId: null, createdAt: 1_700_000_000_000 };
const firstPage: WalletOverview = { balance: 39, packages, paymentEnabled: false, items: [record], page: 1, pageSize: 20, total: 41 };

function renderWallet(client: QueryClient) {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ["/wallet"] }, createElement(WalletPage))));
}

function walletSnapshots(client: QueryClient, userId: string) {
    return client
        .getQueryCache()
        .findAll({ queryKey: ["wallet", userId] })
        .map(({ state }) => ({ data: state.data as WalletOverview | undefined, dataUpdatedAt: state.dataUpdatedAt }));
}

test("a successful newer second ledger page updates the displayed balance from 39 to 38", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(walletQueryOptions("user-a").queryKey, firstPage, { updatedAt: 100 });
    client.setQueryData(walletQueryOptions("user-a", 2).queryKey, { ...firstPage, page: 2, balance: 38 }, { updatedAt: 200 });
    const overview = new QueryObserver(client, { ...walletQueryOptions("user-a"), enabled: false });
    const ledger = new QueryObserver(client, { ...walletQueryOptions("user-a", 2), enabled: false });
    try {
        assert.equal(overview.getCurrentResult().dataUpdatedAt, 100);
        assert.equal(ledger.getCurrentResult().dataUpdatedAt, 200);
        assert.equal(ledger.getCurrentResult().isSuccess, true);
        assert.equal(ledger.getCurrentResult().data?.page, 2);
        assert.equal(walletBalance(walletSnapshots(client, "user-a"), { data: undefined, dataUpdatedAt: 0 }), 38);
        assert.equal(overview.getCurrentResult().data, firstPage);
        assert.equal(overview.getCurrentResult().data?.packages, packages);
    } finally {
        client.clear();
    }
});

test("the newest cached page-two balance survives a page-three placeholder and returning to cached page one", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(walletQueryOptions("user-a").queryKey, firstPage, { updatedAt: 100 });
    client.setQueryData(walletQueryOptions("user-a", 2).queryKey, { ...firstPage, page: 2, balance: 38 }, { updatedAt: 200 });
    const overview = new QueryObserver(client, { ...walletQueryOptions("user-a"), enabled: false });
    const ledger = new QueryObserver(client, { ...walletQueryOptions("user-a", 2), enabled: false });
    const unsubscribe = ledger.subscribe(() => undefined);
    const balance = () => walletBalance(walletSnapshots(client, "user-a"), { data: undefined, dataUpdatedAt: 0 });
    try {
        const balances = [balance()];
        ledger.setOptions({ ...walletQueryOptions("user-a", 3), enabled: false });
        assert.equal(ledger.getCurrentResult().isPlaceholderData, true);
        assert.equal(ledger.getCurrentResult().data?.page, 2);
        assert.equal(ledger.getCurrentResult().dataUpdatedAt, 0);
        assert.equal(client.getQueryState(walletQueryOptions("user-a", 3).queryKey)?.data, undefined);
        assert.equal(client.getQueryState(walletQueryOptions("user-a", 3).queryKey)?.dataUpdatedAt, 0);
        assert.equal(overview.getCurrentResult().isPending, false);
        assert.equal(overview.getCurrentResult().data?.packages, packages);
        balances.push(balance());
        ledger.setOptions({ ...walletQueryOptions("user-a"), enabled: false });
        assert.equal(ledger.getCurrentResult().isPlaceholderData, false);
        assert.equal(ledger.getCurrentResult().data?.page, 1);
        assert.equal(ledger.getCurrentResult().dataUpdatedAt, 100);
        balances.push(balance());
        assert.deepEqual(balances, [38, 38, 38]);
    } finally {
        unsubscribe();
        client.clear();
    }
});

test("the actual page uses the current account's newer cached page two while page one is active", () => {
    const client = new QueryClient();
    // The server snapshot's current userId is empty, matching the existing static page tests.
    client.setQueryData(walletQueryOptions("").queryKey, firstPage, { updatedAt: 100 });
    client.setQueryData(walletQueryOptions("", 2).queryKey, { ...firstPage, page: 2, balance: 38 }, { updatedAt: 200 });
    client.setQueryData(walletQueryOptions("user-b", 2).queryKey, { ...firstPage, page: 2, balance: 999 }, { updatedAt: 1_000 });
    try {
        const html = renderWallet(client);
        assert.match(html, /wallet-balance"><strong>38<\/strong>/);
        assert.match(html, /第 1 页 · 1 条记录/);
        assert.match(html, /启灵卷/);
        assert.match(html, /聚灵卷/);
        assert.match(html, /万象卷/);
        assert.doesNotMatch(html, /wallet-balance"><strong>999<\/strong>/);
    } finally {
        client.clear();
    }
});

test("the actual page lets newer profile and overview balances supersede cached pages without using another account", () => {
    const client = new QueryClient();
    const profile = { realmId: "realm-dou-emperor", unlimited: true, remainingToday: null, paidImages: 37, totalImages: 202 };
    client.setQueryData(walletQueryOptions("").queryKey, firstPage, { updatedAt: 100 });
    client.setQueryData(walletQueryOptions("", 2).queryKey, { ...firstPage, page: 2, balance: 38 }, { updatedAt: 200 });
    client.setQueryData(walletQueryOptions("user-b", 2).queryKey, { ...firstPage, page: 2, balance: 999 }, { updatedAt: 1_000 });
    for (const userId of ["", "local"]) client.setQueryData(cultivationProfileQueryKeyFor(userId), profile, { updatedAt: 300 });
    try {
        assert.match(renderWallet(client), /wallet-balance"><strong>37<\/strong>/);
        client.setQueryData(walletQueryOptions("").queryKey, { ...firstPage, balance: 36 }, { updatedAt: 400 });
        assert.match(renderWallet(client), /wallet-balance"><strong>36<\/strong>/);
    } finally {
        client.clear();
    }
});

test("missing and placeholder snapshots cannot replace a successful balance", () => {
    const overview = { data: firstPage, dataUpdatedAt: 100 };
    const missing = { data: undefined, dataUpdatedAt: 300 };
    const placeholder = { data: { balance: 0 }, dataUpdatedAt: 400, isPlaceholderData: true };
    const profile = { data: { paidImages: 37 }, dataUpdatedAt: 200 };
    assert.equal(walletBalance([overview, missing], missing), 39);
    assert.equal(walletBalance([overview, placeholder], missing), 39);
    assert.equal(walletBalance([missing, placeholder], profile), 37);
    assert.equal(walletBalance([placeholder, missing], profile), 37);
    assert.equal(walletBalance([overview, missing], { ...profile, dataUpdatedAt: 400, isPlaceholderData: true }), 39);
    assert.equal(walletBalance([missing, missing], missing), undefined);
    assert.equal(walletBalance([], missing), undefined);
});

test("the newest successful profile or overview wins and zero is a valid balance", () => {
    const overview = { data: firstPage, dataUpdatedAt: 100 };
    const ledger = { data: { ...firstPage, page: 2, balance: 38 }, dataUpdatedAt: 200 };
    const profile = { data: { paidImages: 37 }, dataUpdatedAt: 300 };
    assert.equal(walletBalance([overview, ledger], profile), 37);
    assert.equal(walletBalance([{ ...overview, dataUpdatedAt: 400 }, ledger], profile), 39);
    assert.equal(walletBalance([overview, ledger], { ...profile, data: { paidImages: 0 } }), 0);
    assert.equal(walletBalance([{ ...overview, data: { ...firstPage, balance: 0 }, dataUpdatedAt: 400 }, ledger], profile), 0);
    assert.equal(walletBalance([overview, { ...ledger, data: { ...ledger.data, balance: 0 }, dataUpdatedAt: 400 }], profile), 0);
});

test("a failed ledger refresh retains its newer successfully cached balance", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(walletQueryOptions("user-a").queryKey, firstPage, { updatedAt: 100 });
    client.setQueryData(walletQueryOptions("user-a", 2).queryKey, { ...firstPage, page: 2, balance: 38 }, { updatedAt: 200 });
    const overview = new QueryObserver(client, { ...walletQueryOptions("user-a"), enabled: false });
    const ledger = new QueryObserver(client, {
        ...walletQueryOptions("user-a", 2),
        enabled: false,
        queryFn: async (): Promise<WalletOverview> => {
            throw new Error("offline");
        },
    });
    try {
        await ledger.refetch();
        const result = ledger.getCurrentResult();
        assert.equal(result.isError, true);
        assert.equal(result.isRefetchError, true);
        assert.equal(result.dataUpdatedAt, 200);
        assert.equal(walletBalance(walletSnapshots(client, "user-a"), { data: undefined, dataUpdatedAt: 0 }), 38);
        assert.equal(overview.getCurrentResult().data, firstPage);
    } finally {
        client.clear();
    }
});

test("the actual page displays the newer overview or profile balance", () => {
    const client = new QueryClient();
    const profile = { realmId: "realm-dou-emperor", unlimited: true, remainingToday: null, paidImages: 38, totalImages: 202 };
    client.setQueryData(walletQueryOptions("").queryKey, firstPage, { updatedAt: 100 });
    for (const userId of ["", "local"]) client.setQueryData(cultivationProfileQueryKeyFor(userId), profile, { updatedAt: 200 });
    try {
        assert.match(renderWallet(client), /wallet-balance"><strong>38<\/strong>/);
        client.setQueryData(walletQueryOptions("").queryKey, firstPage, { updatedAt: 300 });
        assert.match(renderWallet(client), /wallet-balance"><strong>39<\/strong>/);
    } finally {
        client.clear();
    }
});

test("zero paid balance does not imply an unlimited user needs a top-up", () => {
    assert.equal(walletResourceStatus({ unlimited: true, remainingToday: null }, 0), "今日免费不限，可直接创作，无需消耗灵卷。");
});

test("resource status distinguishes free, paid, depleted and unknown quotas", () => {
    assert.match(walletResourceStatus({ unlimited: false, remainingToday: 5 }, 0), /还可免费生成 5 张/);
    assert.match(walletResourceStatus({ unlimited: false, remainingToday: 0 }, 40), /可使用灵卷继续创作/);
    assert.match(walletResourceStatus({ unlimited: false, remainingToday: 0 }, 0), /当前暂无可用生成额度/);
    assert.match(walletResourceStatus({ unlimited: false, remainingToday: 0 }, undefined), /灵卷余额待同步/);
    assert.match(walletResourceStatus(undefined, 0), /免费额度待同步/);
    assert.match(walletResourceStatus({ unlimited: false, remainingToday: null }, 0), /免费额度待同步/);
});

test("unit prices are derived from the actual package instead of promotional copy", () => {
    for (const pack of packages) assert.equal(walletUnitPrice(pack), "约 ¥0.15 / 灵卷");
    assert.equal(walletUnitPrice({ ...packages[0], priceFen: 800 }), "约 ¥0.20 / 灵卷");
    assert.equal(walletUnitPrice({ ...packages[0], images: 0 }), null);
});

test("refund wording includes canceled tasks without inventing an unavailable reason", () => {
    assert.equal(walletLedgerLabels.refund, "灵卷返还");
    assert.equal(walletLedgerLabels.reserve, "生图占用");
    assert.doesNotMatch(walletLedgerLabels.refund, /失败|取消/);
});

test("record sources preserve package names and disclose full long task identifiers", () => {
    assert.deepEqual(walletRecordSource({ ...record, packageId: "juling" }, packages), { label: "聚灵卷" });
    assert.deepEqual(walletRecordSource({ ...record, kind: "admin_grant" }, packages), { label: "管理员发放" });
    assert.deepEqual(walletRecordSource(record, packages), { label: "任务 12345678…9abc", fullId: record.sourceId });
    assert.deepEqual(walletRecordSource({ ...record, sourceId: "short-job" }, packages), { label: "任务 short-job", fullId: undefined });
});

test("long source disclosure uses native keyboard-operable details and selectable full text", () => {
    const html = renderToStaticMarkup(createElement(WalletRecordSource, { item: record, packages }));
    assert.match(html, /<details class="wallet-source-disclosure">/);
    assert.match(html, /<summary>/);
    assert.match(html, /任务 12345678…9abc/);
    assert.match(html, /查看完整任务编号/);
    assert.match(html, /<code>12345678-abcd-4321-1234-123456789abc<\/code>/);
    assert.doesNotMatch(html, /<details[^>]* open/);
});

test("short sources do not add a redundant disclosure control", () => {
    const html = renderToStaticMarkup(createElement(WalletRecordSource, { item: { ...record, sourceId: "short-job" }, packages }));
    assert.match(html, /任务 short-job/);
    assert.doesNotMatch(html, /<details/);
});

test("pagination placeholders never carry another account's wallet data", () => {
    const options = walletQueryOptions("user-b", 2);
    assert.equal(options.placeholderData(firstPage, { queryKey: ["wallet", "user-a", 1] }), undefined);
    assert.equal(options.placeholderData(firstPage, { queryKey: ["wallet", "user-b", 1] }), firstPage);
    assert.equal(options.placeholderData(firstPage, undefined), undefined);
    assert.equal(walletQueryOptions("").enabled, false);
});

test("resource and ledger observers deduplicate the first-page request", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let requestCount = 0;
    const options = {
        ...walletQueryOptions("user-a"),
        queryFn: async () => {
            requestCount++;
            return firstPage;
        },
    };
    const overview = new QueryObserver(client, options);
    const ledger = new QueryObserver(client, options);
    const unsubscribeOverview = overview.subscribe(() => undefined);
    const unsubscribeLedger = ledger.subscribe(() => undefined);
    try {
        await ledger.refetch({ cancelRefetch: false });
        assert.equal(requestCount, 1);
        assert.equal(overview.getCurrentResult().data, firstPage);
        assert.equal(ledger.getCurrentResult().data, firstPage);
    } finally {
        unsubscribeOverview();
        unsubscribeLedger();
        client.clear();
    }
});

test("an uncached ledger page keeps resources ready and previous records visible while loading", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(walletQueryOptions("user-a").queryKey, firstPage);
    const overview = new QueryObserver(client, { ...walletQueryOptions("user-a"), queryFn: async () => firstPage });
    const ledger = new QueryObserver(client, { ...walletQueryOptions("user-a"), queryFn: async () => firstPage });
    const unsubscribeOverview = overview.subscribe(() => undefined);
    const unsubscribeLedger = ledger.subscribe(() => undefined);
    let finishPage!: (value: WalletOverview) => void;
    const nextPage = new Promise<WalletOverview>((resolve) => {
        finishPage = resolve;
    });
    try {
        ledger.setOptions({ ...walletQueryOptions("user-a", 2), queryFn: () => nextPage });
        assert.equal(overview.getCurrentResult().isPending, false);
        assert.equal(overview.getCurrentResult().data?.balance, 39);
        assert.equal(overview.getCurrentResult().data?.packages.length, 3);
        assert.equal(ledger.getCurrentResult().isPlaceholderData, true);
        assert.equal(ledger.getCurrentResult().data?.page, 1);
        const loading = ledger.refetch({ cancelRefetch: false });
        finishPage({ ...firstPage, page: 2, items: [{ ...record, id: "record-2" }] });
        await loading;
        assert.equal(ledger.getCurrentResult().data?.page, 2);
        assert.equal(ledger.getCurrentResult().isPlaceholderData, false);
        assert.equal(overview.getCurrentResult().data?.page, 1);
    } finally {
        unsubscribeOverview();
        unsubscribeLedger();
        client.clear();
    }
});

test("failed background refreshes preserve the successfully loaded balance, packages and records", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(walletQueryOptions("user-a").queryKey, firstPage);
    const observer = new QueryObserver(client, {
        ...walletQueryOptions("user-a"),
        queryFn: async (): Promise<WalletOverview> => {
            throw new Error("offline");
        },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
        await observer.refetch();
        const result = observer.getCurrentResult();
        assert.equal(result.isError, true);
        assert.equal(result.isRefetchError, true);
        assert.equal(result.data, firstPage);
        assert.equal(result.data.balance, 39);
        assert.equal(result.data.items[0].id, "record-1");
    } finally {
        unsubscribe();
        client.clear();
    }
});

test("a failed uncached ledger page does not replace or fail the loaded resource overview", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(walletQueryOptions("user-a").queryKey, firstPage);
    const overview = new QueryObserver(client, { ...walletQueryOptions("user-a"), queryFn: async () => firstPage });
    const ledger = new QueryObserver(client, { ...walletQueryOptions("user-a"), queryFn: async () => firstPage });
    const unsubscribeOverview = overview.subscribe(() => undefined);
    const unsubscribeLedger = ledger.subscribe(() => undefined);
    try {
        ledger.setOptions({
            ...walletQueryOptions("user-a", 2),
            queryFn: async (): Promise<WalletOverview> => {
                throw new Error("page unavailable");
            },
        });
        await ledger.refetch({ cancelRefetch: false });
        assert.equal(ledger.getCurrentResult().isError, true);
        assert.equal(overview.getCurrentResult().isError, false);
        assert.equal(overview.getCurrentResult().isPending, false);
        assert.equal(overview.getCurrentResult().data, firstPage);
    } finally {
        unsubscribeOverview();
        unsubscribeLedger();
        client.clear();
    }
});

test("switching the query observer to another account immediately removes previous records", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(walletQueryOptions("user-a").queryKey, firstPage);
    const observer = new QueryObserver(client, { ...walletQueryOptions("user-a"), queryFn: async () => firstPage });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
        observer.setOptions({ ...walletQueryOptions("user-b"), queryFn: async () => firstPage, enabled: false });
        assert.equal(observer.getCurrentResult().data, undefined);
        assert.equal(observer.getCurrentResult().isPlaceholderData, false);
    } finally {
        unsubscribe();
        client.clear();
    }
});

test("the actual page renders zero balance with unlimited free creation and interface-derived package prices", () => {
    const client = new QueryClient();
    // Zustand's server snapshot starts with no user; seed both profile runtime modes without making HTTP requests.
    client.setQueryData(walletQueryOptions("").queryKey, { ...firstPage, balance: 0, items: [], total: 0 });
    for (const userId of ["", "local"]) client.setQueryData(cultivationProfileQueryKeyFor(userId), { realmId: "realm-dou-emperor", unlimited: true, remainingToday: null, paidImages: 0, totalImages: 202 });
    try {
        const html = renderWallet(client);
        assert.match(html, /今日免费不限，可直接创作，无需消耗灵卷/);
        assert.match(html, /斗帝 · 诸天至尊/);
        assert.match(html, /启灵卷/);
        assert.match(html, /聚灵卷/);
        assert.match(html, /万象卷/);
        assert.match(html, /¥6\.00/);
        assert.match(html, /¥15\.00/);
        assert.match(html, /¥45\.00/);
        assert.match(html, /约 ¥0\.15 \/ 灵卷/);
        assert.match(html, /仅记录灵卷收支，免费额度使用不在此列/);
        assert.match(html, /支付功能暂未开放/);
        assert.match(html, /href="\/image"/);
        assert.doesNotMatch(html, /需要充值|最划算|超值/);
    } finally {
        client.clear();
    }
});

test("the actual page keeps packages and records visible after a background refresh fails", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = walletQueryOptions("").queryKey;
    client.setQueryData(key, firstPage);
    await assert.rejects(
        client.fetchQuery({
            queryKey: key,
            queryFn: async () => {
                throw new Error("offline");
            },
            staleTime: 0,
        }),
        /offline/,
    );
    try {
        const html = renderWallet(client);
        assert.match(html, /资源更新未完成/);
        assert.match(html, /已保留上次加载的内容/);
        assert.match(html, /重新加载/);
        assert.match(html, /启灵卷/);
        assert.match(html, /聚灵卷/);
        assert.match(html, /万象卷/);
        assert.match(html, /生图占用/);
        assert.match(html, /任务 12345678…9abc/);
        assert.match(html, /wallet-balance"><strong>39<\/strong>/);
        assert.doesNotMatch(html, /wallet-package-loading/);
    } finally {
        client.clear();
    }
});

test("an initial page load failure offers retry without presenting a false empty ledger", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await assert.rejects(
        client.fetchQuery({
            queryKey: walletQueryOptions("").queryKey,
            queryFn: async () => {
                throw new Error("offline");
            },
        }),
        /offline/,
    );
    try {
        const html = renderWallet(client);
        assert.match(html, /灵卷数据暂时无法加载/);
        assert.match(html, /重新加载/);
        assert.doesNotMatch(html, /尚无灵卷流转记录/);
    } finally {
        client.clear();
    }
});
