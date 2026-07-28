import type { CSSProperties } from "react";
import { Crown } from "lucide-react";
import { Popover, Switch, Tooltip } from "antd";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

import { isDouEmperorRealm, useImperialMode } from "./imperial-mode";
import { RealmIcon } from "./realm-icon";
import { useCultivationProfile } from "./queries";
import { cultivationAccentColor, cultivationStageLabel, quotaText } from "./utils";

/**
 * 顶部身份徽章。
 * 普通境界:境界 pill,点击进命宫。
 * 斗帝:金态「斗帝 · 诸天至尊」,Popover 内含身份卡与帝临偏好开关
 * (合并原 ImperialModeBadge 的入口,顶部不再挂两个徽章)。
 */
export function CultivationStatusPill() {
    const { data } = useCultivationProfile();
    const { isImperialMode, imperialWelcomeEnabled, setImperialModeEnabled, setImperialWelcomeEnabled } = useImperialMode();
    if (!data) return null;
    const isDouEmperor = isDouEmperorRealm(data.realmId);
    const label = isDouEmperor ? "斗帝 · 诸天至尊" : cultivationStageLabel(data.realmName, data.stageName);
    const accentColor = cultivationAccentColor(data.color);
    const status = (
        <Link
            to="/cultivation"
            className={cn(
                "cultivation-status-pill inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-sm font-medium lg:h-8 lg:w-auto lg:min-w-0 lg:gap-2 lg:px-2.5",
                isDouEmperor ? "is-imperial-identity !text-[#e4ca8b] hover:!text-[#f3dfad]" : "!text-stone-700 hover:!text-stone-950 dark:!text-stone-200 dark:hover:!text-white",
            )}
            style={{ "--cultivation-accent": accentColor } as CSSProperties}
            title={isDouEmperor ? undefined : `${label} · ${quotaText(data.remainingToday, data.unlimited)}`}
            aria-label={`打开我的修炼:${label}`}
        >
            <RealmIcon iconKey={data.iconKey} className="size-3.5 shrink-0" />
            <span className="hidden max-w-32 truncate lg:block">{label}</span>
            <span className="hidden text-xs text-stone-400 lg:block dark:text-stone-500">{data.unlimited ? "∞" : data.remainingToday}</span>
        </Link>
    );

    if (!isDouEmperor) return status;
    return (
        <Popover
            placement="bottomRight"
            trigger="click"
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
                    </div>
                </div>
            }
        >
            <span className="inline-flex">{status}</span>
        </Popover>
    );
}
