import { Link } from "react-router-dom";

import { RealmIcon } from "./realm-icon";
import { useCultivationProfile } from "./queries";
import { quotaText } from "./utils";

export function CultivationStatusPill() {
    const { data } = useCultivationProfile();
    if (!data) return null;
    return (
        <Link
            to="/cultivation"
            className="hidden h-8 min-w-0 items-center gap-2 rounded-md border px-2.5 text-xs transition hover:bg-stone-50 lg:flex dark:hover:bg-stone-900"
            style={{ borderColor: `${data.color}55`, color: data.color }}
            title={`${data.realmName} ${data.stageName} · ${quotaText(data.remainingToday, data.unlimited)}`}
        >
            <RealmIcon iconKey={data.iconKey} className="size-3.5 shrink-0" />
            <span className="max-w-28 truncate font-medium">
                {data.realmName} {data.stageName}
            </span>
            <span className="text-stone-400 dark:text-stone-500">{data.unlimited ? "∞" : data.remainingToday}</span>
        </Link>
    );
}
