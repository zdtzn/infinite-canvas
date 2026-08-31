import { type CSSProperties, useState } from "react";
import { ArrowUpRight, Crown } from "lucide-react";
import { Popover, Switch } from "antd";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

import { isDouEmperorRealm, useImperialMode } from "./imperial-mode";
import { RealmIcon } from "./realm-icon";
import { useCultivationProfile } from "./queries";
import { cultivationAccentColor, cultivationStageLabel, quotaText } from "./utils";
import "./cultivation-visuals.css";

/**
 * 顶部身份徽章。
 * 普通境界:境界 pill,点击进命宫。
 * 斗帝:金态「斗帝 · 诸天至尊」,Popover 内含身份卡与帝临偏好开关
 * (合并原 ImperialModeBadge 的入口,顶部不再挂两个徽章)。
 */
export function CultivationStatusPill() {
    const { data } = useCultivationProfile();
    const { isImperialMode, imperialWelcomeEnabled, setImperialModeEnabled, setImperialWelcomeEnabled } = useImperialMode();
    const [identityOpen, setIdentityOpen] = useState(false);
    if (!data) return null;
    const isDouEmperor = isDouEmperorRealm(data.realmId);
    const label = isDouEmperor ? "斗帝 · 诸天至尊" : cultivationStageLabel(data.realmName, data.stageName);
    const accentColor = cultivationAccentColor(data.color);
    const statusClassName = cn(
        "cultivation-status-pill inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-sm font-medium lg:h-8 lg:w-auto lg:min-w-0 lg:gap-2 lg:px-2.5",
        isDouEmperor ? "is-imperial-identity !text-[#e4ca8b] hover:!text-[#f3dfad]" : "!text-stone-700 hover:!text-stone-950 dark:!text-stone-200 dark:hover:!text-white",
    );
    const statusContent = (
        <>
            <RealmIcon iconKey={data.iconKey} className="size-3.5 shrink-0" />
            <span className="cultivation-status-copy hidden max-w-32 truncate lg:block">{label}</span>
            {!isDouEmperor ? <span className="cultivation-status-copy hidden text-xs text-stone-400 lg:block dark:text-stone-500">{data.remainingToday}</span> : null}
        </>
    );

    if (!isDouEmperor)
        return (
            <Link
                to="/cultivation"
                className={statusClassName}
                style={{ "--cultivation-accent": accentColor } as CSSProperties}
                title={`${label} · ${quotaText(data.remainingToday, data.unlimited)}`}
                aria-label={`打开我的修炼：${label}`}
            >
                {statusContent}
            </Link>
        );

    return (
        <Popover
            placement="bottomRight"
            trigger="click"
            open={identityOpen}
            onOpenChange={setIdentityOpen}
            content={
                <div className="imperial-identity-card">
                    <div className="imperial-identity-card-mark" aria-hidden="true">
                        <Crown className="size-4" />
                    </div>
                    <div>
                        <div className="imperial-identity-card-eyebrow">最高身份</div>
                        <strong>斗帝</strong>
                        <p>诸天至尊</p>
                        <div className="imperial-identity-card-divider" />
                        <span>已登临修炼终点</span>
                        <span>创作永无止境</span>
                        <div className="imperial-identity-card-divider" />
                        <span className="imperial-identity-card-pref">
                            帝临模式
                            <Switch size="small" checked={isImperialMode} onChange={setImperialModeEnabled} aria-label="启用帝临模式" />
                        </span>
                        <span className="imperial-identity-card-pref">
                            首页欢迎
                            <Switch size="small" checked={imperialWelcomeEnabled} onChange={setImperialWelcomeEnabled} aria-label="首页欢迎" />
                        </span>
                        <Link to="/cultivation" className="mt-2 inline-flex items-center gap-1 text-xs font-medium !text-[#b99a55] hover:!text-[#e4ca8b]" onClick={() => setIdentityOpen(false)}>
                            查看我的修炼
                            <ArrowUpRight className="size-3" aria-hidden="true" />
                        </Link>
                    </div>
                </div>
            }
        >
            <button
                type="button"
                className={statusClassName}
                style={{ "--cultivation-accent": accentColor } as CSSProperties}
                aria-label="查看斗帝身份与帝临设置"
            >
                {statusContent}
            </button>
        </Popover>
    );
}
