import { useQuery } from "@tanstack/react-query";
import { Button, Pagination, Skeleton } from "antd";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Info, ScrollText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { isDouEmperorRealm } from "@/features/cultivation/imperial-mode";
import { ImperialSeal } from "@/features/cultivation/imperial-seal";
import { useCultivationProfile } from "@/features/cultivation/queries";
import { RealmIcon } from "@/features/cultivation/realm-icon";
import { cultivationStageLabel } from "@/features/cultivation/utils";
import { fetchWallet, type WalletLedgerItem, type WalletPackage } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import "./wallet.css";

const ledgerLabels: Record<WalletLedgerItem["kind"], string> = {
    admin_grant: "管理员发放",
    reserve: "生图占用",
    refund: "失败返还",
};
const packageDescriptions: Record<string, string> = {
    qiling: "偶尔执笔，轻量补充",
    juling: "为持续创作备好灵卷",
    wanxiang: "为高频创作留足余量",
};
function recordSource(item: WalletLedgerItem, packages: WalletPackage[]) {
    if (item.packageId) return packages.find((pack) => pack.id === item.packageId)?.name || item.packageId;
    return item.kind === "admin_grant" ? "管理员发放" : "任务 " + item.sourceId;
}

export default function WalletPage() {
    const userId = useUserStore((state) => state.user?.id || "");
    const [page, setPage] = useState(1);
    const wallet = useQuery({ queryKey: ["wallet", userId, page], queryFn: () => fetchWallet(page), enabled: Boolean(userId), staleTime: 10_000 });
    const { data: profile } = useCultivationProfile();
    const imperial = Boolean(profile && isDouEmperorRealm(profile.realmId));
    const data = wallet.data;
    const loading = wallet.isPending;

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
                            <strong>{data?.balance.toLocaleString() ?? "—"}</strong>
                            <span>灵卷</span>
                        </p>
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
                            <h2>灵卷数据暂时无法加载</h2>
                            <p>请重新加载，查看最新余额与记录。</p>
                        </div>
                        <Button onClick={() => void wallet.refetch()}>重新加载</Button>
                    </section>
                ) : (
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
                                            <p className="wallet-package-amount">
                                                <strong>{item.images.toLocaleString()}</strong>
                                                <span>灵卷</span>
                                            </p>
                                            <div className="wallet-package-price">
                                                <span>¥{(item.priceFen / 100).toFixed(2)}</span>
                                                <small>套餐价格</small>
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
                                    <strong>1 灵卷对应 1 张图片生成额度。</strong>生成时优先使用今日免费额度，不足部分使用灵卷，失败部分返还。
                                </p>
                            </div>
                        </section>
                        <section className="wallet-ledger" aria-labelledby="wallet-ledger-heading" aria-busy={loading}>
                            <div className="wallet-section-heading">
                                <div>
                                    <h2 id="wallet-ledger-heading">灵卷记录</h2>
                                    <p>每一份补给，每一次创作，都有迹可循。</p>
                                </div>
                                {data?.total ? <span className="wallet-record-count">共 {data.total.toLocaleString()} 条</span> : null}
                            </div>
                            {loading ? (
                                <div className="wallet-ledger-loading">
                                    <Skeleton active paragraph={{ rows: 3 }} />
                                </div>
                            ) : data?.items.length ? (
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
                                                {data.items.map((item) => (
                                                    <tr key={item.id}>
                                                        <td>
                                                            <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
                                                        </td>
                                                        <td>{ledgerLabels[item.kind]}</td>
                                                        <td className={item.delta > 0 ? "wallet-credit" : "wallet-debit"}>
                                                            {item.delta > 0 ? "+" : ""}
                                                            {item.delta.toLocaleString()}
                                                        </td>
                                                        <td className="wallet-record-source">{recordSource(item, data.packages)}</td>
                                                        <td>
                                                            {item.balanceAfter.toLocaleString()} <small>灵卷</small>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <ul className="wallet-ledger-mobile">
                                        {data.items.map((item) => (
                                            <li key={item.id}>
                                                <div className="wallet-record-top">
                                                    <span>
                                                        {item.delta > 0 ? <ArrowDownLeft size={17} aria-hidden="true" /> : <ArrowUpRight size={17} aria-hidden="true" />}
                                                        {ledgerLabels[item.kind]}
                                                    </span>
                                                    <strong className={item.delta > 0 ? "wallet-credit" : "wallet-debit"}>
                                                        {item.delta > 0 ? "+" : ""}
                                                        {item.delta.toLocaleString()}
                                                    </strong>
                                                </div>
                                                <p className="wallet-record-source">{recordSource(item, data.packages)}</p>
                                                <div className="wallet-record-meta">
                                                    <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
                                                    <span>余额 {item.balanceAfter.toLocaleString()} 灵卷</span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            ) : (
                                <div className="wallet-empty">
                                    <span className="wallet-empty-symbol">
                                        <ScrollText size={32} strokeWidth={1} aria-hidden="true" />
                                    </span>
                                    <div>
                                        <h3>尚无灵卷流转记录</h3>
                                        <p>灵卷的获取与消耗会记录在这里。</p>
                                    </div>
                                </div>
                            )}
                            {(data?.total || 0) > 20 ? <Pagination className="wallet-pagination" current={page} pageSize={20} total={data?.total} onChange={setPage} showSizeChanger={false} responsive /> : null}
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
