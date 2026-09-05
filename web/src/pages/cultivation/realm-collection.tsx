import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import "./realm-collection.css";

export const PALACE_REALMS = [
    { id: "realm-dou-qi", name: "斗之气", inscription: "初感天地" },
    { id: "realm-dou-zhe", name: "斗者", inscription: "气旋初成" },
    { id: "realm-dou-shi", name: "斗师", inscription: "凝气化铠" },
    { id: "realm-da-dou-shi", name: "大斗师", inscription: "斗气外放" },
    { id: "realm-dou-ling", name: "斗灵", inscription: "灵韵显化" },
    { id: "realm-dou-wang", name: "斗王", inscription: "振翼凌空" },
    { id: "realm-dou-huang", name: "斗皇", inscription: "御气而行" },
    { id: "realm-dou-zong", name: "斗宗", inscription: "踏虚破界" },
    { id: "realm-dou-zun", name: "斗尊", inscription: "执掌空间" },
    { id: "realm-half-saint", name: "半圣", inscription: "圣意初生" },
    { id: "realm-dou-saint", name: "斗圣", inscription: "法则入圣" },
    { id: "realm-dou-emperor", name: "斗帝", inscription: "万法归一" },
] as const;

const TONES = ["#66d9bb", "#70baff", "#76dbaa", "#b991ff", "#68b5ff", "#ff8963", "#edcb82", "#b799ed", "#7abaff", "#7bdbb8", "#fba285", "#f0d59b"];

export function palaceInsignia(realmId: string) {
    return `/cultivation-realms/insignia/${realmId}.webp`;
}

export function RealmCollection({ realmId }: { realmId: string }) {
    const [selected, setSelected] = useState<string>(realmId);
    const inspectionRef = useRef<HTMLDivElement>(null);
    const currentIndex = PALACE_REALMS.findIndex((realm) => realm.id === realmId);
    const selectedIndex = PALACE_REALMS.findIndex((realm) => realm.id === selected);
    const realm = PALACE_REALMS[selectedIndex >= 0 ? selectedIndex : Math.max(0, currentIndex)];
    const stateLabel = (index: number) => index < currentIndex ? "已铭刻" : index === currentIndex ? "当前境界" : "待点亮";
    return (
        <section className="realm-collection" aria-labelledby="realm-collection-title">
            <header className="realm-collection-heading">
                <div><span className="realm-eyebrow">境界藏阁 · 成长之证</span><h2 id="realm-collection-title" className="font-display">十二境 · 一路生辉</h2><p>每一次创作，都是通往下一重天地的足迹。</p></div>
                <div className="realm-collection-count"><strong>{String(Math.max(0, currentIndex + 1)).padStart(2, "0")}</strong><span>/ 12 境已点亮</span></div>
            </header>
            <div className="realm-collection-layout">
                <div ref={inspectionRef} className="realm-inspection" aria-live="polite">
                    <span className="realm-eyebrow">境界鉴赏</span>
                    <img src={palaceInsignia(realm.id)} alt={`${realm.name}完整勋章`} width={640} height={640} decoding="async" />
                    <h3 className="font-display">{realm.name}</h3>
                    <p>{realm.inscription}</p>
                    <span className="realm-inspection-state">{stateLabel(PALACE_REALMS.indexOf(realm))}</span>
                    <small>选择勋章，查看完整境界之印</small>
                </div>
                <ol className="realm-collection-grid">
                    {PALACE_REALMS.map((item, index) => (
                        <li key={item.id} className={index > currentIndex ? "is-future" : index === currentIndex ? "is-current" : "is-passed"} style={{ "--realm-tone": TONES[index] } as CSSProperties}>
                            <button type="button" aria-pressed={realm.id === item.id} aria-label={`${item.name}，${stateLabel(index)}，查看勋章`} onClick={() => {
                                setSelected(item.id);
                                if (window.matchMedia("(max-width: 680px)").matches) inspectionRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
                            }}>
                                <span className="realm-card-index">{String(index + 1).padStart(2, "0")}</span>
                                <img src={palaceInsignia(item.id)} alt="" width={640} height={640} loading={index === currentIndex ? "eager" : "lazy"} decoding="async" />
                                <strong>{item.name}</strong>
                                <span className="realm-card-state">{stateLabel(index)}</span>
                            </button>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
