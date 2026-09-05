import { type CSSProperties, Suspense, useState } from "react";
import { Popover } from "antd";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";
import { lazyRoute } from "@/lib/lazy-route";

import { isDouEmperorRealm } from "./imperial-mode";
import { ImperialSeal } from "./imperial-seal";
import { RealmIcon } from "./realm-icon";
import { useCultivationProfile } from "./queries";
import { cultivationAccentColor, cultivationStageLabel, quotaText } from "./utils";
import "./cultivation-visuals.css";

const ImperialIdentity = lazyRoute(() => import("./imperial-identity"));

/**
 * 顶部身份徽章。
 * 普通境界:境界 pill,点击进命宫。
 * 斗帝:金态「斗帝 · 诸天至尊」,Popover 内含身份卡与帝临偏好开关
 * (合并原 ImperialModeBadge 的入口,顶部不再挂两个徽章)。
 */
export function CultivationStatusPill() {
    const { data } = useCultivationProfile();
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
            {isDouEmperor ? <ImperialSeal className="size-7" decorative /> : <RealmIcon iconKey={data.iconKey} className="size-3.5 shrink-0" />}
            <span className="cultivation-status-copy hidden max-w-32 truncate lg:block">{label}</span>
            {!isDouEmperor ? <span className="cultivation-status-copy hidden text-xs text-stone-400 lg:block dark:text-stone-500">{data.remainingToday}</span> : null}
        </>
    );

    if (!isDouEmperor)
        return (
            <Link to="/cultivation" className={statusClassName} style={{ "--cultivation-accent": accentColor } as CSSProperties} title={`${label} · ${quotaText(data.remainingToday, data.unlimited)}`} aria-label={`打开我的修炼：${label}`}>
                {statusContent}
            </Link>
        );

    return (
        <Popover
            placement="bottom"
            trigger="click"
            open={identityOpen}
            onOpenChange={setIdentityOpen}
            styles={{ container: { background: "#18211f", border: "1px solid rgb(210 192 146 / 24%)", borderRadius: 8 } }}
            content={
                <Suspense
                    fallback={
                        <div className="flex h-80 w-64 items-center justify-center text-sm text-[#dac395]" role="status">
                            帝印展开中...
                        </div>
                    }
                >
                    {identityOpen ? <ImperialIdentity onClose={() => setIdentityOpen(false)} /> : <span />}
                </Suspense>
            }
        >
            <button type="button" className={statusClassName} style={{ "--cultivation-accent": accentColor } as CSSProperties} aria-label="查看斗帝身份与帝临设置">
                {statusContent}
            </button>
        </Popover>
    );
}
