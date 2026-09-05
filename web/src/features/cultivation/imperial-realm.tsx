import { ArrowDown, ArrowRight, PenLine } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { LightRays } from "@/components/home/light-rays";
import { SpecularButton } from "@/components/ui/specular-button";
import { preloadRoute } from "@/lib/route-loaders";

import { ImperialSeal } from "./imperial-seal";
import "./imperial-realm.css";

export default function ImperialRealm({ preview = false }: { preview?: boolean }) {
    const navigate = useNavigate();
    return (
        <section className={`imperial-realm${preview ? " imperial-realm--preview" : ""}`} aria-label={preview ? "帝境外观预览" : "帝境首页"}>
            <picture className="imperial-realm-scene" aria-hidden="true">
                <source media="(max-width: 640px)" srcSet="/imperial/realm-scene-mobile-v1.webp" />
                <img src="/imperial/realm-scene-v1.webp" width={1536} height={1024} alt="" fetchPriority="high" decoding="async" />
            </picture>
            <div className="imperial-realm-veil" aria-hidden="true" />
            <LightRays
                raysOrigin="top-center"
                raysColor="#ffd166"
                raysSpeed={0.72}
                lightSpread={0.74}
                rayLength={1.68}
                pulsating
                fadeDistance={1.2}
                saturation={1.16}
                followMouse
                mouseInfluence={0.08}
                noiseAmount={0.045}
                distortion={0.045}
                className="homepage-light-rays is-imperial"
            />
            <div className="imperial-realm-heading">
                <span className="imperial-realm-kicker">帝境已启</span>
                <span className="imperial-realm-seal">
                    <ImperialSeal />
                </span>
                <div className="imperial-realm-rank">
                    <i aria-hidden="true" />
                    <span>斗帝 · 诸天至尊</span>
                    <i aria-hidden="true" />
                </div>
                <h1 className="font-brush">无限画布</h1>
                <p className="font-display">执笔天地，万象由心。</p>
                {preview ? (
                    <span className="imperial-realm-preview-label">帝临模式 · 外观预览</span>
                ) : (
                    <div className="imperial-realm-actions">
                        <SpecularButton
                            onClick={() => navigate("/canvas?mode=new")}
                            onPointerEnter={() => void preloadRoute("/canvas")}
                            onFocus={() => void preloadRoute("/canvas")}
                            onTouchStart={() => void preloadRoute("/canvas")}
                            radius={8}
                            tint="#d8402a"
                            tintOpacity={0.96}
                            blur={4}
                            textColor="#fff7ee"
                            lineColor="#ffe7b3"
                            baseColor="#8f2a20"
                            intensity={1.15}
                            shineSize={9}
                            shineFade={38}
                            thickness={1}
                            proximity={220}
                            className="imperial-realm-create"
                        >
                            <PenLine className="size-4" aria-hidden="true" />
                            起笔 · 新建画布
                            <ArrowRight className="size-4" aria-hidden="true" />
                        </SpecularButton>
                        <Link className="imperial-realm-recent" to="/canvas?mode=recent" onPointerEnter={() => void preloadRoute("/canvas")} onFocus={() => void preloadRoute("/canvas")} onTouchStart={() => void preloadRoute("/canvas")}>
                            继续最近项目
                            <ArrowRight className="size-4" aria-hidden="true" />
                        </Link>
                    </div>
                )}
            </div>
            <div className="imperial-realm-footer" aria-hidden="true">
                <span>星河为卷 · 灵感为墨</span>
                <ArrowDown size={14} />
                <span>一念落笔 · 万象成卷</span>
            </div>
        </section>
    );
}
