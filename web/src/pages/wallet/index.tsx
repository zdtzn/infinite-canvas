import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Pagination, Result, Skeleton } from "antd";
import { ArrowDownLeft, ArrowUpRight, ImagePlus, ScrollText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useCultivationProfile } from "@/features/cultivation/queries";
import { fetchWallet, type WalletLedgerItem } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

const ledgerLabels: Record<WalletLedgerItem["kind"], string> = {
    admin_grant: "管理员发放",
    reserve: "生图占用",
    refund: "失败返还",
};

export default function WalletPage() {
    const userId = useUserStore((state) => state.user?.id || "");
    const [page, setPage] = useState(1);
    const wallet = useQuery({ queryKey: ["wallet", userId, page], queryFn: () => fetchWallet(page), enabled: Boolean(userId), staleTime: 10_000 });
    const { data: profile } = useCultivationProfile();

    if (wallet.isError) return <Result status="warning" title="灵卷记录暂时无法加载" extra={<Button onClick={() => void wallet.refetch()}>重新加载</Button>} />;

    return (
        <main className="h-full overflow-y-auto bg-[#111114] text-[#eeece6]">
            <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-7">
                    <div>
                        <p className="text-xs font-medium text-[#bca67e]">LING JUAN GE</p>
                        <h1 className="font-brush mt-2 text-4xl">灵卷阁</h1>
                    </div>
                    <Link to="/image" className="inline-flex min-h-10 items-center gap-2 text-sm !text-[#d8c59f] hover:!text-white"><ImagePlus size={17} />前往丹青台</Link>
                </header>

                <section className="grid gap-0 border-b border-white/10 py-7 sm:grid-cols-2" aria-label="生图次数余额">
                    <div className="border-b border-white/10 pb-5 sm:border-b-0 sm:border-r sm:pb-0">
                        <p className="text-sm text-[#a6a5a2]">今日免费剩余</p>
                        <p className="mt-2 text-3xl font-semibold tabular-nums">{profile ? profile.unlimited ? "不限" : profile.remainingToday?.toLocaleString() : "—"}<span className="ml-2 text-base font-normal text-[#a6a5a2]">次</span></p>
                    </div>
                    <div className="pt-5 sm:pl-8 sm:pt-0">
                        <p className="text-sm text-[#a6a5a2]">灵卷可用</p>
                        <p className="mt-2 text-3xl font-semibold tabular-nums text-[#e8c884]">{wallet.data?.balance.toLocaleString() ?? "—"}<span className="ml-2 text-base font-normal text-[#a6a5a2]">次</span></p>
                    </div>
                </section>

                <section className="py-8" aria-labelledby="wallet-packages-heading">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 id="wallet-packages-heading" className="text-xl font-semibold">灵卷套餐</h2>
                        <span className="text-sm text-[#a6a5a2]">每张 ¥0.15 · 支付暂未开放</span>
                    </div>
                    {wallet.isLoading ? <Skeleton active className="mt-6" /> : <div className="mt-5 grid gap-3 md:grid-cols-3">
                        {wallet.data?.packages.map((item) => (
                            <article key={item.id} className="flex min-h-48 flex-col justify-between rounded-lg border border-white/15 bg-[#1c1d20] p-5">
                                <div>
                                    <div className="flex items-center gap-2 text-sm text-[#d9b978]"><ScrollText size={16} />{item.name}</div>
                                    <p className="mt-4 text-3xl font-semibold tabular-nums">{item.images}<span className="ml-1 text-base font-normal text-[#b8b6b1]">张</span></p>
                                </div>
                                <div className="mt-5 flex items-end justify-between gap-3">
                                    <p className="text-lg font-semibold tabular-nums">¥{(item.priceFen / 100).toFixed(2)}</p>
                                    <Button disabled aria-label={`${item.name}支付暂未开放`}>暂未开放</Button>
                                </div>
                            </article>
                        ))}
                    </div>}
                </section>

                <section className="border-t border-white/10 py-7" aria-labelledby="wallet-ledger-heading">
                    <h2 id="wallet-ledger-heading" className="text-xl font-semibold">收支记录</h2>
                    {wallet.isLoading ? <Skeleton active className="mt-5" /> : wallet.data?.items.length ? (
                        <div className="mt-4 divide-y divide-white/10">
                            {wallet.data.items.map((item) => (
                                <div key={item.id} className="flex min-h-18 items-center justify-between gap-3 py-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white/[0.06] text-[#c9b58a]">{item.delta > 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
                                        <div className="min-w-0"><p className="text-sm font-medium">{ledgerLabels[item.kind]}{item.packageId ? ` · ${wallet.data.packages.find((pack) => pack.id === item.packageId)?.name || item.packageId}` : ""}</p><p className="mt-1 text-xs text-[#a6a5a2]">{new Date(item.createdAt).toLocaleString("zh-CN")} · 余额 {item.balanceAfter} 次</p></div>
                                    </div>
                                    <span className={`shrink-0 font-semibold tabular-nums ${item.delta > 0 ? "text-[#9cd3b5]" : "text-[#e8c884]"}`}>{item.delta > 0 ? "+" : ""}{item.delta}</span>
                                </div>
                            ))}
                        </div>
                    ) : <Empty className="mt-10" description={<span className="text-[#a6a5a2]">暂无收支记录</span>} />}
                    {(wallet.data?.total || 0) > 20 ? <Pagination className="mt-6" current={page} pageSize={20} total={wallet.data?.total} onChange={setPage} showSizeChanger={false} /> : null}
                </section>
            </div>
        </main>
    );
}
