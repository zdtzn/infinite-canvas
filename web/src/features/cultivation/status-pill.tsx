import type { CSSProperties } from "react";
import { Tooltip } from "antd";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

import { isDouEmperorRealm } from "./imperial-mode";
import { RealmIcon } from "./realm-icon";
import { useCultivationProfile } from "./queries";
import { cultivationAccentColor, cultivationStageLabel, quotaText } from "./utils";

export function CultivationStatusPill() {
    const { data } = useCultivationProfile();
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
            aria-label={`打开我的修炼：${label}`}
        >
            <RealmIcon iconKey={data.iconKey} className="size-3.5 shrink-0" />
            <span className="hidden max-w-32 truncate lg:block">{label}</span>
            <span className="hidden text-xs text-stone-400 lg:block dark:text-stone-500">{data.unlimited ? "∞" : data.remainingToday}</span>
        </Link>
    );

    if (!isDouEmperor) return status;
    return (
        <Tooltip
            title={
                <span className="block py-0.5">
                    <span className="block font-medium">当前世界最高境界</span>
                    <span className="mt-0.5 block text-xs opacity-70">诸天万界皆可入画</span>
                </span>
            }
        >
            {status}
        </Tooltip>
    );
}
