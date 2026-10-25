import { Users } from "lucide-react";
import { Link } from "react-router-dom";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 洞府 · 设置(方案B「山海境」)
 * 配置逻辑零改动,仅场景化页头。
 */
export default function ConfigPage() {
    const admin = useUserStore((state) => Boolean(state.user?.admin));
    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto max-w-6xl px-6 py-8">
                <div className="mb-6">
                    <p className="shj-hero-eyebrow">Dong Fu</p>
                    <h1 className="font-brush mt-3 text-4xl text-foreground sm:text-5xl">洞府</h1>
                    <p className="font-display mt-3 text-sm tracking-[0.15em] text-[#8a8a96]">府中机括,皆由你调 · 渠道聚合、模型选择与同步偏好</p>
                    {admin ? (
                        <Link to="/admin/cultivation?tab=users" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Users className="size-4" aria-hidden="true" />
                            管理用户与次数
                        </Link>
                    ) : null}
                    <hr className="shj-gold-hairline mt-6" />
                </div>
                <AppConfigPanel />
            </div>
        </main>
    );
}
