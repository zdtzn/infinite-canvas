import type { CultivationProfile, WalletLedgerItem, WalletOverview, WalletPackage } from "@/services/server-api";

export const walletLedgerLabels: Record<WalletLedgerItem["kind"], string> = {
    admin_grant: "管理员发放",
    reserve: "生图占用",
    refund: "灵卷返还",
};

export function walletQueryOptions(userId: string, page = 1) {
    return {
        queryKey: ["wallet", userId, page] as const,
        enabled: Boolean(userId),
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        placeholderData: (previousData: WalletOverview | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined) => (previousQuery?.queryKey[1] === userId ? previousData : undefined),
    };
}

type WalletBalanceSnapshot<T> = { data: T | undefined; dataUpdatedAt: number; isPlaceholderData?: boolean };

export function walletBalance(wallets: readonly WalletBalanceSnapshot<Pick<WalletOverview, "balance">>[], profile: WalletBalanceSnapshot<Pick<CultivationProfile, "paidImages">>) {
    return [...wallets.map((snapshot) => ({ balance: snapshot.data?.balance, snapshot })), { balance: profile.data?.paidImages, snapshot: profile }]
        .filter(({ balance, snapshot }) => balance !== undefined && !snapshot.isPlaceholderData)
        .sort((a, b) => b.snapshot.dataUpdatedAt - a.snapshot.dataUpdatedAt)[0]?.balance;
}

export function walletResourceStatus(profile: Pick<CultivationProfile, "unlimited" | "remainingToday"> | undefined, balance: number | undefined) {
    if (profile?.unlimited) return "今日免费不限，可直接创作，无需消耗灵卷。";
    if (!profile || profile.remainingToday === null) return "灵卷余额不包含今日免费额度，免费额度待同步。";
    if (profile.remainingToday > 0) return `今日还可免费生成 ${profile.remainingToday.toLocaleString()} 张，之后再使用灵卷。`;
    if (balance === undefined) return "今日免费额度已用完，灵卷余额待同步。";
    if (balance > 0) return "今日免费额度已用完，可使用灵卷继续创作。";
    return "当前暂无可用生成额度，可前往命宫查看额度与境界。";
}

const unitPriceFormatter = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function walletUnitPrice(pack: WalletPackage) {
    return pack.images > 0 ? `约 ${unitPriceFormatter.format(pack.priceFen / 100 / pack.images)} / 灵卷` : null;
}

export function walletRecordSource(item: WalletLedgerItem, packages: WalletPackage[]) {
    if (item.packageId) return { label: packages.find((pack) => pack.id === item.packageId)?.name || item.packageId };
    if (item.kind === "admin_grant") return { label: "管理员发放" };
    const shortId = item.sourceId.length > 16 ? `${item.sourceId.slice(0, 8)}…${item.sourceId.slice(-4)}` : item.sourceId;
    return { label: `任务 ${shortId}`, fullId: item.sourceId.length > 16 ? item.sourceId : undefined };
}
