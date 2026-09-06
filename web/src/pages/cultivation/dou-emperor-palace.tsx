import type { ChangeEvent, RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Aperture, ArrowUpRight, CalendarDays, Camera, Cpu, Expand, Focus, Gauge, ImagePlus, Infinity as InfinityIcon, Layers3, LoaderCircle, Maximize2, Orbit, Palette, ScanLine, Settings2, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import type { CultivationProfile } from "@/services/server-api";
import "./dou-emperor-palace.css";
import "./sovereign-domain.css";
import { RealmCollection } from "./realm-collection";

type DouEmperorPalaceProps = {
    profile: CultivationProfile;
    avatarUrl: string;
    avatarUploading: boolean;
    avatarInputRef: RefObject<HTMLInputElement | null>;
    onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
    admin: boolean;
};



export function DouEmperorPalace({ profile, avatarUrl, avatarUploading, avatarInputRef, onAvatarChange, admin }: DouEmperorPalaceProps) {
    const capabilities = profile.capabilities;
    const modelUsage = profile.modelUsage || [];

    return (
        <main className="dep-page palace-redesign">
            <section className="dep-hero" aria-labelledby="dou-emperor-title">
                <img className="dep-hero-art" src="/cultivation-realms/realm-dou-emperor.webp" alt="星河、天地法则与中央帝座构成的斗帝帝境" width={1600} height={900} decoding="async" fetchPriority="high" />
                <div className="dep-hero-depth" aria-hidden="true" />
                <div className="dep-star-field" aria-hidden="true" />
                <div className="dep-space-cracks" aria-hidden="true" />
                <div className="dep-law-orbit dep-law-orbit-outer" aria-hidden="true" />
                <div className="dep-law-orbit dep-law-orbit-inner" aria-hidden="true" />
                <div className="dep-hero-grain" aria-hidden="true" />

                <div className="dep-hero-toolbar">
                    <div className="dep-profile">
                        <div className="dep-avatar-wrap">
                            <ProfileAvatarImage src={avatarUrl} alt={`${profile.displayName} 的头像`} fallback={profile.displayName.slice(0, 1).toUpperCase()} width={48} height={48} loading="eager" fetchPriority="high" className="dep-avatar" />
                            <button type="button" className="dep-avatar-button" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} aria-label="上传头像" title="上传头像">
                                {avatarUploading ? <LoaderCircle className="size-3 animate-spin" /> : <Camera className="size-3" />}
                            </button>
                            <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={onAvatarChange} />
                        </div>
                        <div>
                            <span className="dep-profile-kicker">命宫 · 帝境领域</span>
                            <strong>{profile.displayName}</strong>
                        </div>
                    </div>

                    <nav className="dep-hero-actions" aria-label="命宫快捷操作">
                        {admin ? (
                            <Link to="/admin/cultivation" className="dep-hero-link">
                                <Settings2 className="size-4" aria-hidden="true" />
                                修炼管理
                            </Link>
                        ) : null}
                        <Link to="/image" className="dep-hero-link">
                            <ImagePlus className="size-4" aria-hidden="true" />
                            丹青台
                        </Link>
                        <Link to="/canvas" className="dep-hero-primary-action">
                            <Maximize2 className="size-4" aria-hidden="true" />
                            回到画布
                        </Link>
                    </nav>
                </div>

                <div className="dep-hero-center">
                    <div className="dep-imperial-crest" aria-hidden="true">
                        <span className="dep-imperial-crest-frame">
                            <img src="/cultivation-realms/dou-emperor-character.png" alt="" width={1024} height={1536} decoding="async" fetchPriority="high" />
                        </span>
                    </div>
                    <div className="dep-sovereign-copy">
                    <span className="dep-arrival-mark">
                        <span aria-hidden="true" />
                        万道归一 · 诸天共尊
                        <span aria-hidden="true" />
                    </span>
                    <div className="dep-emperor-title-wrap">
                        <InfinityIcon className="dep-emperor-sigil" aria-hidden="true" />
                        <h1 id="dou-emperor-title" className="font-brush dep-emperor-title">
                            斗帝
                        </h1>
                    </div>
                    <p className="font-display dep-emperor-rank">诸天之上，唯我独尊。</p>
                    <p className="font-display dep-emperor-state">手握日月摘星辰，世间无我这般人。</p>
                    <p className="dep-emperor-decree">万界俯首，诸法皆臣。<br />此身已登绝巅，落笔再造诸天。</p>

                    <dl className="dep-hero-metrics" aria-label="帝境创作总览">
                        <HeroMetric label="累计修为" value={profile.totalXp.toLocaleString()} />
                        <HeroMetric label="累计作品" value={profile.totalImages.toLocaleString()} />
                        <HeroMetric label="创作天数" value={profile.activeDays.toLocaleString()} suffix="天" />
                    </dl>

                    <Link to="/image" className="dep-create-action">
                        <Sparkles className="size-4" aria-hidden="true" />
                        执笔 · 开天辟地
                        <ArrowUpRight className="size-4" aria-hidden="true" />
                    </Link>
                    </div>
                </div>

                <div className="dep-hero-footnote" aria-hidden="true">
                    <span>天地无上</span>
                    <i />
                    <span>创作无疆</span>
                </div>
            </section>

            <div className="dep-domain">
                {profile.publicMessage ? (
                    <section className="dep-notice" aria-live="polite">
                        <span>掌教谕令</span>
                        <p>{profile.publicMessage}</p>
                    </section>
                ) : null}

                <RealmCollection realmId="realm-dou-emperor" />

                <div className="sovereign-domain sovereign-scroll">
                    <img className="sovereign-scroll-art" src="/cultivation-realms/realm-dou-emperor.webp" alt="" width={1600} height={900} loading="lazy" decoding="async" aria-hidden="true" />
                    <section className="sovereign-laws" aria-labelledby="law-control-title">
                        <header className="sovereign-section-heading">
                            <div><span className="realm-eyebrow">一念御万法</span><h2 id="law-control-title" className="font-display">万法皆臣</h2></div>
                            <p>已掌 <strong>{capabilities.length}</strong> 道创作法则</p>
                        </header>
                        <p className="sovereign-law-declaration">万法随心，一念皆应。</p>
                    </section>
                    <section className="sovereign-works" aria-labelledby="creation-epoch-title">
                        <header className="sovereign-section-heading">
                            <div><span className="realm-eyebrow">功业镌星河</span><h2 id="creation-epoch-title" className="font-display">落笔成诸天</h2></div>
                            <p>每一幅作品，皆是此世留名。</p>
                        </header>
                        <div className="sovereign-achievements">
                            <div className="sovereign-work-total"><span>累计作品</span><strong>{profile.totalImages.toLocaleString()}<small>幅</small></strong><p>一笔一界，尽入星河</p></div>
                            <dl className="sovereign-metrics">
                                <EpochMetric icon={CalendarDays} label="创作天数" value={`${profile.activeDays.toLocaleString()} 天`} />
                                <EpochMetric icon={Gauge} label="累计修为" value={profile.totalXp.toLocaleString()} />
                                <EpochMetric icon={Activity} label="今日创作" value={`${profile.usedToday.toLocaleString()} 次`} />
                            </dl>
                        </div>
                        <details className="sovereign-model-details">
                            <summary>模型使用明细 <span>{modelUsage.length} 个模型</span></summary>
                            {modelUsage.length ? <ul>{modelUsage.map((item) => <li key={item.model}><span>{item.model}</span><strong>{item.images.toLocaleString()} 幅</strong></li>)}</ul> : <p>完成图像创作后，这里会显示真实的模型使用记录。</p>}
                        </details>
                    </section>
                    <footer className="sovereign-creed">
                        <span className="realm-eyebrow">万界俯首 · 诸法皆臣</span>
                        <p className="font-display">此身已登绝巅，<br /><strong>落笔再造诸天。</strong></p>
                        <Link to="/image">执笔 · 开天辟地 <ArrowUpRight className="size-4" aria-hidden="true" /></Link>
                    </footer>
                </div>
            </div>
        </main>
    );
}

function HeroMetric({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
    return (
        <div>
            <dt>{label}</dt>
            <dd>
                {value}
                {suffix ? <span>{suffix}</span> : null}
            </dd>
        </div>
    );
}

function EpochMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
    return (
        <div>
            <dt>
                <Icon className="size-4" aria-hidden="true" />
                {label}
            </dt>
            <dd>{value}</dd>
        </div>
    );
}

