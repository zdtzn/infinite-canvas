import { Crown } from "lucide-react";
import { Switch } from "antd";

import { useImperialMode } from "./imperial-mode";

export function ImperialModePreferences() {
    const { isDouEmperor, isImperialMode, imperialWelcomeEnabled, setImperialModeEnabled, setImperialWelcomeEnabled } = useImperialMode();
    if (!isDouEmperor) return null;

    return (
        <section className="imperial-mode-preferences">
            <div className="imperial-mode-preferences-heading">
                <div>
                    <div className="inline-flex items-center gap-2 text-sm font-semibold">
                        <Crown className="size-4" />
                        帝临模式
                    </div>
                    <p>斗帝专属视觉偏好仅保存在当前浏览器，不影响创作配置。</p>
                </div>
            </div>
            <div className="imperial-mode-preference-row">
                <div>
                    <div className="text-sm font-medium">启用帝临模式</div>
                    <p>使用深空蓝、淡金强调和极淡星纹主题。</p>
                </div>
                <Switch size="small" checked={isImperialMode} onChange={setImperialModeEnabled} />
            </div>
            <div className="imperial-mode-preference-row">
                <div>
                    <div className="text-sm font-medium">首页欢迎</div>
                    <p>每天首次进入网站时显示一次斗帝欢迎提示。</p>
                </div>
                <Switch size="small" checked={imperialWelcomeEnabled} onChange={setImperialWelcomeEnabled} />
            </div>
        </section>
    );
}
