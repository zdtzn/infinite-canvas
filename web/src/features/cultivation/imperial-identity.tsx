import { Switch } from "antd";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import { useImperialMode } from "./imperial-mode";
import { ImperialSeal } from "./imperial-seal";
import { useCultivationProfile } from "./queries";
import "./imperial-identity.css";

export default function ImperialIdentity({ onClose }: { onClose: () => void }) {
    const { data } = useCultivationProfile();
    const { isImperialMode, imperialWelcomeEnabled, setImperialModeEnabled, setImperialWelcomeEnabled } = useImperialMode();
    return (
        <section className="emperor-identity" aria-label="斗帝身份">
            <header>
                <span className="emperor-identity-eyebrow">诸天至尊</span>
                <ImperialSeal className="emperor-identity-seal" />
                <h2 className="font-display">斗帝</h2>
                <p>已至巅峰，创作无界。</p>
            </header>
            <dl>
                <div>
                    <dt>累计创作</dt>
                    <dd>
                        {data?.totalImages.toLocaleString() ?? "-"}
                        <small>幅</small>
                    </dd>
                </div>
                <div>
                    <dt>创作岁月</dt>
                    <dd>
                        {data?.activeDays.toLocaleString() ?? "-"}
                        <small>天</small>
                    </dd>
                </div>
            </dl>
            <div className="emperor-identity-preference">
                <label htmlFor="emperor-mode-switch">帝临模式</label>
                <Switch id="emperor-mode-switch" checked={isImperialMode} onChange={setImperialModeEnabled} aria-label="启用帝临模式" />
            </div>
            <div className="emperor-identity-preference">
                <label htmlFor="emperor-welcome-switch">入场礼遇</label>
                <Switch id="emperor-welcome-switch" checked={imperialWelcomeEnabled} onChange={setImperialWelcomeEnabled} aria-label="入场礼遇" />
            </div>
            <Link to="/cultivation" onClick={onClose}>
                进入命宫
                <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
        </section>
    );
}
