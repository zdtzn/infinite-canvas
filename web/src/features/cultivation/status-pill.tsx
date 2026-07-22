import { Link } from "react-router-dom";

import { RealmIcon } from "./realm-icon";
import { useCultivationProfile } from "./queries";
import { cultivationStageLabel, quotaText } from "./utils";

export function CultivationStatusPill() {
    const { data } = useCultivationProfile();
    if (!data) return null;
    const label = cultivationStageLabel(data.realmName, data.stageName);
    return (
        <Link
            to="/cultivation"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-xs transition hover:bg-stone-50 lg:h-8 lg:w-auto lg:min-w-0 lg:gap-2 lg:px-2.5 dark:hover:bg-stone-900"
            style={{ borderColor: `${data.color}55`, color: data.color }}
            title={`${label} · ${quotaText(data.remainingToday, data.unlimited)}`}
            aria-label={`打开我的修炼：${label}`}
        >
            <RealmIcon iconKey={data.iconKey} className="size-3.5 shrink-0" />
            <span className="hidden max-w-28 truncate font-medium lg:block">{label}</span>
            <span className="hidden text-stone-400 lg:block dark:text-stone-500">{data.unlimited ? "∞" : data.remainingToday}</span>
        </Link>
    );
}
