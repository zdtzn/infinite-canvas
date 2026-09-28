import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Pagination, Skeleton } from "antd";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Info, ScrollText } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";

import { isDouEmperorRealm } from "@/features/cultivation/imperial-mode";
import { ImperialSeal } from "@/features/cultivation/imperial-seal";
import { useCultivationProfile } from "@/features/cultivation/queries";
import { RealmIcon } from "@/features/cultivation/realm-icon";
import { cultivationStageLabel } from "@/features/cultivation/utils";
import { fetchWallet, type WalletOverview } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { WalletRecordSource } from "./wallet-record-source";
import { walletBalance, walletLedgerLabels, walletQueryOptions, walletResourceStatus, walletUnitPrice } from "./wallet-ui";
import "./wallet.css";

const packageDescriptions: Record<string, string> = {
    qiling: "偶尔执笔，轻量补充",
    juling: "为持续创作备好灵卷",
    wanxiang: "为高频创作留足余量",
};

export default function WalletPage() {
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id || "");
    const [page, setPage] = useState(1);
    const wallet = useQuery({ ...walletQueryOptions(userId), queryFn: () => fetchWallet() });
    const ledger = useQuery({ ...walletQueryOptions(userId, page), queryFn: () => fetchWallet(page) });
    const profileQuery = useCultivationProfile();
    const profile = profileQuery.data;
    const subscribeWalletBalance = useCallback(
        (onStoreChange: () => void) =>
            queryClient.getQueryCache().subscribe((event) => {
                if (event.query.queryKey[0] === "wallet" && event.query.queryKey[1] === userId && (event.type === "added" || event.type === "removed" || event.type === "updated")) {
                    onStoreChange();
                }
            }),
        [queryClient, userId],
    );
    const getWalletBalance = useCallback(
        () =>
            walletBalance(
                queryClient
                    .getQueryCache()
                    .findAll({ queryKey: ["wallet", userId] })
                    .map(({ state }) => ({ data: state.data as WalletOverview | undefined, dataUpdatedAt: state.dataUpdatedAt })),
                profileQuery,
            ),
        [profileQuery, queryClient, userId],
    );
    const balance = useSyncExternalStore(subscribeWalletBalance, getWalletBalance, getWalletBalance);
    const imperial = Boolean(profile && isDouEmperorRealm(profile.realmId));
    const data = wallet.data;
    const loading = wallet.isPending;
    const records = ledger.data;
    const recordTotal = records?.total ?? data?.total ?? 0;
    const recordPackages = records?.packages ?? data?.packages ?? [];

    return (
        <main className="wallet-space h-full overflow-y-auto">
            <div className="wallet-content">
                <header className="wallet-heading">
                    <p className="wallet-eyebrow">LING JUAN GE / 创作补给</p>
                    <h1 className="font-brush">灵卷阁</h1>
                    <p>补充灵卷，继续执笔万象</p>
                </header>
                <section className={"wallet-hero" + (imperial ? " is-imperial" : "")} aria-label="我的创作资源">
                    <svg className="wallet-hero-art" viewBox="0 0 680 280" fill="none" aria-hidden="true">
                        <path d="M20 250C180 235 240 75 440 90S600 150 700 25M-20 270C170 260 230 100 430 115S610 175 720 55" />
                        <path d="M235 280V62Q235 42 255 42H554Q574 42 574 62V245M255 42V245H610M280 67H545M280 80H465" />
                        <ellipse cx="442" cy="180" rx="205" ry="60" transform="rotate(-23 442 180)" />
                        <circle cx="560" cy="78" r="2" />
                        <circle cx="338" cy="180" r="2" />
                        <circle cx="612" cy="194" r="1.5" />
                    </svg>
                    <div className="wallet-hero-main">
                        {profile ? (
                            <Link to="/cultivation" className="wallet-identity">
                                {imperial ? (
                                    <ImperialSeal className="size-7" decorative />
                                ) : (
                                    <span aria-hidden="true">
                                        <RealmIcon iconKey={profile.iconKey} className="size-4" />
                                    </span>
                                )}
                                {imperial ? "斗帝 · 诸天至尊" : cultivationStageLabel(profile.realmName, profile.stageName)}
                            </Link>
                        ) : (
                            <span className="wallet-identity">我的创作资源</span>
                        )}
                        <p className="wallet-balance-label">当前灵卷</p>
                        <p className="wallet-balance">
                            <strong>{balance?.toLocaleString() ?? "—"}</strong>
                            <span>灵卷</span>
                        </p>
                        <p className="wallet-resource-status">{walletResourceStatus(profile, balance)}</p>
                        <dl className="wallet-resource-details">
                            <div>
                                <dt>今日免费剩余</dt>
                                <dd>
                                    {profile ? (profile.unlimited ? "不限" : (profile.remainingToday?.toLocaleString() ?? "—")) : "—"}
                                    {profile && !profile.unlimited && profile.remainingToday !== null ? <small> 次</small> : null}
                                </dd>
                            </div>
                            <div>
                                <dt>累计创作</dt>
                                <dd>
                                    {profile?.totalImages.toLocaleString() ?? "—"}
                                    <small> 张</small>
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <div className="wallet-hero-action">
                        <p>灵卷在手，画卷可续。</p>
                        <Link to="/image" className="wallet-create">
                            继续创作 <ArrowRight size={18} aria-hidden="true" />
                        </Link>
                        <span>前往丹青台</span>
                    </div>
                </section>

                {wallet.isError ? (
                    <section className="wallet-load-error" role="alert">
                        <div>
                            <h2>{data ? "资源更新未完成" : "灵卷数据暂时无法加载"}</h2>
                            <p>{data ? "已保留上次加载的内容，请重试以查看最新数据。" : "请重新加载，查看最新余额与套餐。"}</p>
                        </div>
                        <Button loading={wallet.isFetching} onClick={() => void wallet.refetch()}>
                            重新加载
                        </Button>
                    </section>
                ) : null}
                {data || loading ? (
                    <>
                        <section className="wallet-packages" aria-labelledby="wallet-packages-heading" aria-busy={loading}>
                            <div className="wallet-section-heading">
                                <div>
                                    <h2 id="wallet-packages-heading">补充创作资源</h2>
                                    <p>按你的创作节奏，选择一份补给。</p>
                                </div>
                                {data && !data.paymentEnabled ? (
                                    <span className="wallet-availability">
                                        <Info size={15} aria-hidden="true" />
                                        支付功能暂未开放
                                    </span>
                                ) : null}
                            </div>
                            {loading ? (
                                <div className="wallet-package-grid">
                                    {[0, 1, 2].map((key) => (
                                        <div className="wallet-package wallet-package-loading" key={key}>
                                            <Skeleton active paragraph={{ rows: 4 }} />
                                        </div>
                                    ))}
                                </div>
                            ) : data?.packages.length ? (
                                <div className="wallet-package-grid">
                                    {data.packages.map((item) => (
                                        <article key={item.id} className={"wallet-package" + (item.id === "juling" ? " is-recommended" : "") + (item.id === "wanxiang" ? " is-volume" : "")}>
                                            <div className="wallet-package-top">
                                                <ScrollText size={23} strokeWidth={1.25} aria-hidden="true" />
                                                {item.id === "juling" ? <span className="wallet-recommended">推荐</span> : <span className="wallet-package-tier">{item.id === "qiling" ? "基础补充" : item.id === "wanxiang" ? "大量创作" : "创作补给"}</span>}
                                            </div>
                                            <h3>{item.name}</h3>
                                            <p className="wallet-package-description">{packageDescriptions[item.id] || "为下一幅作品补充灵卷"}</p>
                                            <div className="wallet-package-resources">
                                                <p className="wallet-package-amount">
                                                    <strong>{item.images.toLocaleString()}</strong>
                                                    <span>灵卷</span>
                                                </p>
                                                <div className="wallet-package-price">
                                                    <span>¥{(item.priceFen / 100).toFixed(2)}</span>
                                                    <small>{walletUnitPrice(item)}</small>
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <p className="wallet-no-packages">暂无可展示的灵卷套餐</p>
                            )}
                            <div className="wallet-rules">
                                <Info size={17} aria-hidden="true" />
                                <p>
                                    <strong>1 灵卷对应 1 张图片生成额度。</strong>优先使用今日免费额度，不足部分使用灵卷；未生成结果的灵卷按实际结算返还。
                                </p>
                            </div>
                        </section>
                        <section className="wallet-ledger" aria-labelledby="wallet-ledger-heading" aria-busy={ledger.isFetching}>
                            <div className="wallet-section-heading">
                                <div>
                                    <h2 id="wallet-ledger-heading">灵卷记录</h2>
                                    <p>仅记录灵卷收支，免费额度使用不在此列。</p>
                                </div>
                                {recordTotal ? <span className="wallet-record-count">共 {recordTotal.toLocaleString()} 条</span> : null}
                            </div>
                            <p className="wallet-ledger-status" role="status" aria-live="polite" aria-atomic="true">
                                {ledger.isPlaceholderData ? `正在加载第 ${page} 页，当前显示第 ${records?.page} 页记录…` : ledger.isFetching && records ? "正在更新记录…" : records ? `第 ${records.page} 页 · ${records.items.length} 条记录` : ""}
                            </p>
                            {ledger.isError && !(page === 1 && wallet.isError) ? (
                                <div className="wallet-load-error wallet-record-error" role="alert">
                                    <div>
                                        <h3>{records ? "记录更新未完成" : `第 ${page} 页记录加载失败`}</h3>
                                        <p>{records ? "已保留已加载的记录，请重试更新。" : "余额与套餐仍可查看，请重试加载记录。"}</p>
                                    </div>
                                    <Button loading={ledger.isFetching} onClick={() => void ledger.refetch()}>
                                        重试记录
                                    </Button>
                                </div>
                            ) : null}
                            {ledger.isPending ? (
                                <div className="wallet-ledger-loading">
                                    <Skeleton active paragraph={{ rows: 3 }} />
                                </div>
                            ) : records?.items.length ? (
                                <>
                                    <div className="wallet-ledger-desktop">
                                        <table>
                                            <caption className="sr-only">灵卷获取与消耗记录</caption>
                                            <thead>
                                                <tr>
                                                    <th scope="col">时间</th>
                                                    <th scope="col">类型</th>
                                                    <th scope="col">数量变化</th>
                                                    <th scope="col">来源</th>
                                                    <th scope="col">余额</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {records.items.map((item) => (
                                                    <tr key={item.id}>
                                                        <td>
                                                            <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
                                                        </td>
                                                        <td>{walletLedgerLabels[item.kind]}</td>
                                                        <td className={item.delta > 0 ? "wallet-credit" : "wallet-debit"}>
                                                            {item.delta > 0 ? "+" : ""}
                                                            {item.delta.toLocaleString()}
                                                        </td>
                                                        <td className="wallet-record-source">
                                                            <WalletRecordSource item={item} packages={recordPackages} />
                                                        </td>
                                                        <td>
                                                            {item.balanceAfter.toLocaleString()} <small>灵卷</small>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <ul className="wallet-ledger-mobile">
                                        {records.items.map((item) => (
                                            <li key={item.id}>
                                                <div className="wallet-record-top">
                                                    <span>
                                                        {item.delta > 0 ? <ArrowDownLeft size={17} aria-hidden="true" /> : <ArrowUpRight size={17} aria-hidden="true" />}
                                                        {walletLedgerLabels[item.kind]}
                                                    </span>
                                                    <strong className={item.delta > 0 ? "wallet-credit" : "wallet-debit"}>
                                                        {item.delta > 0 ? "+" : ""}
                                                        {item.delta.toLocaleString()}
                                                    </strong>
                                                </div>
                                                <div className="wallet-record-source">
                                                    <WalletRecordSource item={item} packages={recordPackages} />
                                                </div>
                                                <div className="wallet-record-meta">
                                                    <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
                                                    <span>余额 {item.balanceAfter.toLocaleString()} 灵卷</span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            ) : records ? (
                                <div className="wallet-empty">
                                    <span className="wallet-empty-symbol">
                                        <ScrollText size={32} strokeWidth={1} aria-hidden="true" />
                                    </span>
                                    <div>
                                        <h3>尚无灵卷流转记录</h3>
                                        <p>灵卷的获取与消耗会记录在这里。</p>
                                    </div>
                                </div>
                            ) : null}
                            {recordTotal > 20 ? <Pagination className="wallet-pagination" current={page} pageSize={20} total={recordTotal} onChange={setPage} disabled={ledger.isPlaceholderData} showSizeChanger={false} responsive /> : null}
                        </section>
                    </>
                ) : null}
            </div>
        </main>
    );
}
