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
                </div>
            </div>
            <div className="imperial-mode-preference-row">
                <div>
                    <div className="text-sm font-medium">帝境外观</div>
                </div>
                <Switch checked={isImperialMode} onChange={setImperialModeEnabled} aria-label="启用帝临模式" />
            </div>
            <div className="imperial-mode-preference-row">
                <div>
                    <div className="text-sm font-medium">入场礼遇</div>
                </div>
                <Switch checked={imperialWelcomeEnabled} onChange={setImperialWelcomeEnabled} aria-label="入场礼遇" />
            </div>
        </section>
    );
}
