import { AppConfigPanel } from "@/components/layout/app-config-modal";

/**
 * 洞府 · 设置(方案B「山海境」)
 * 配置逻辑零改动,仅场景化页头。
 */
export default function ConfigPage() {
    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto max-w-6xl px-6 py-8">
                <div className="mb-6">
                    <p className="shj-hero-eyebrow">Dong Fu</p>
                    <h1 className="font-brush mt-3 text-4xl text-[#edede6] sm:text-5xl">洞府</h1>
                    <p className="font-display mt-3 text-sm tracking-[0.15em] text-[#8a8a96]">府中机括,皆由你调 · 渠道聚合、模型选择与同步偏好</p>
                    <hr className="shj-gold-hairline mt-6" />
                </div>
                <AppConfigPanel />
            </div>
        </main>
    );
}
