import type { ChangeEvent, RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Aperture, ArrowUpRight, CalendarDays, Camera, Cpu, Expand, Focus, Gauge, ImagePlus, Infinity as InfinityIcon, Layers3, LoaderCircle, Maximize2, Orbit, Palette, ScanLine, Settings2, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import type { CultivationProfile } from "@/services/server-api";
import "./dou-emperor-palace.css";

type DouEmperorPalaceProps = {
    profile: CultivationProfile;
    avatarUrl: string;
    avatarUploading: boolean;
    avatarInputRef: RefObject<HTMLInputElement | null>;
    onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
    admin: boolean;
};

type CapabilityMeta = {
    label: string;
    detail: string;
    icon: LucideIcon;
    group: "generation" | "feature" | "model" | "product" | "other";
};

const CAPABILITY_META: Record<string, CapabilityMeta> = {
    "generation.hd": { label: "高清生成", detail: "高规格画面输出", icon: ScanLine, group: "generation" },
    "generation.references": { label: "参考图创作", detail: "多图引导与视觉融合", icon: ImagePlus, group: "generation" },
    "generation.inpaint": { label: "局部重绘", detail: "精确修改局部区域", icon: Focus, group: "generation" },
    "generation.outpaint": { label: "扩图", detail: "延展画面边界与构图", icon: Expand, group: "generation" },
    "feature.lora": { label: "LoRA", detail: "风格与角色定向控制", icon: Layers3, group: "feature" },
    "feature.controlnet": { label: "ControlNet", detail: "结构、姿态与空间约束", icon: Orbit, group: "feature" },
    "model.gpt-image": { label: "GPT Image", detail: "通用图像生成领域", icon: Cpu, group: "model" },
    "model.gemini": { label: "Gemini", detail: "多模态图像创作领域", icon: Cpu, group: "model" },
    "model.flux": { label: "Flux", detail: "高质量视觉生成领域", icon: Cpu, group: "model" },
    "product.basic": { label: "基础商品视觉", detail: "商品素材基础炼制", icon: Palette, group: "product" },
    "product.main_image": { label: "商品主图", detail: "平台主视觉生成", icon: Palette, group: "product" },
    "product.analysis": { label: "商品分析", detail: "识别卖点与视觉方向", icon: Aperture, group: "product" },
    "product.detail_page": { label: "商品详情页", detail: "完整详情视觉规划", icon: Palette, group: "product" },
    "product.multi_style": { label: "多视觉方案", detail: "同品多风格演化", icon: Sparkles, group: "product" },
    "product.batch_generate": { label: "批量商品创作", detail: "多商品并行规划", icon: Activity, group: "product" },
    "product.brand_design": { label: "品牌视觉体系", detail: "统一品牌表达与规范", icon: Layers3, group: "product" },
};

const GROUP_LABELS: Array<{ key: CapabilityMeta["group"]; title: string; subtitle: string }> = [
    { key: "generation", title: "生成法则", subtitle: "画面质量与编辑控制" },
    { key: "feature", title: "控制法则", subtitle: "结构、风格与定向能力" },
    { key: "model", title: "模型领域", subtitle: "可调动的模型能力" },
    { key: "product", title: "商品领域", subtitle: "商业视觉创作能力" },
    { key: "other", title: "其他法则", subtitle: "已授权的扩展能力" },
];

const REALM_JOURNEY = [
    { id: "realm-dou-qi", name: "斗之气" },
    { id: "realm-dou-zhe", name: "斗者" },
    { id: "realm-dou-shi", name: "斗师" },
    { id: "realm-da-dou-shi", name: "大斗师" },
    { id: "realm-dou-ling", name: "斗灵" },
    { id: "realm-dou-wang", name: "斗王" },
    { id: "realm-dou-huang", name: "斗皇" },
    { id: "realm-dou-zong", name: "斗宗" },
    { id: "realm-dou-zun", name: "斗尊" },
    { id: "realm-half-saint", name: "半圣" },
    { id: "realm-dou-saint", name: "斗圣" },
    { id: "realm-dou-emperor", name: "斗帝" },
] as const;

const MODEL_COLORS = ["#d9b96f", "#7db2d8", "#dce8f2", "#7789a4", "#a96858", "#5f958c"];

export function DouEmperorPalace({ profile, avatarUrl, avatarUploading, avatarInputRef, onAvatarChange, admin }: DouEmperorPalaceProps) {
    const capabilities = profile.capabilities.map((key) => ({ key, ...(CAPABILITY_META[key] || fallbackCapabilityMeta(key)) }));
    const capabilityGroups = GROUP_LABELS.map((group) => ({ ...group, items: capabilities.filter((item) => item.group === group.key) })).filter((group) => group.items.length);
    const modelUsage = profile.modelUsage || [];
    const totalModelImages = modelUsage.reduce((total, item) => total + item.images, 0);
    const modelGradient = buildModelGradient(modelUsage);

    return (
        <main className="dep-page">
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
                    <span className="dep-arrival-mark">
                        <span aria-hidden="true" />
                        帝境降临
                        <span aria-hidden="true" />
                    </span>
                    <div className="dep-emperor-title-wrap">
                        <InfinityIcon className="dep-emperor-sigil" aria-hidden="true" />
                        <h1 id="dou-emperor-title" className="font-brush dep-emperor-title">
                            斗帝
                        </h1>
                    </div>
                    <p className="font-display dep-emperor-rank">诸天至尊</p>
                    <p className="dep-emperor-state">已登临最高境界。</p>

                    <dl className="dep-hero-metrics" aria-label="帝境创作总览">
                        <HeroMetric label="累计修为" value={profile.totalXp.toLocaleString()} />
                        <HeroMetric label="累计作品" value={profile.totalImages.toLocaleString()} />
                        <HeroMetric label="创作天数" value={profile.activeDays.toLocaleString()} suffix="天" />
                    </dl>

                    <Link to="/image" className="dep-create-action">
                        <Sparkles className="size-4" aria-hidden="true" />
                        继续创作
                        <ArrowUpRight className="size-4" aria-hidden="true" />
                    </Link>
                </div>

                <div className="dep-hero-footnote" aria-hidden="true">
                    <span>万法归一</span>
                    <i />
                    <span>创作无尽</span>
                </div>
            </section>

            <div className="dep-domain">
                {profile.publicMessage ? (
                    <section className="dep-notice" aria-live="polite">
                        <span>掌教谕令</span>
                        <p>{profile.publicMessage}</p>
                    </section>
                ) : null}

                <section className="dep-journey" aria-labelledby="emperor-journey-title">
                    <div className="dep-section-heading">
                        <div>
                            <span>ASCENSION RECORD</span>
                            <h2 id="emperor-journey-title" className="font-display">
                                登帝之路
                            </h2>
                        </div>
                        <p>十二境皆已走过。此处记录来路，不再指向下一次升级。</p>
                    </div>
                    <div className="dep-journey-scroll" tabIndex={0} aria-label="从斗之气至斗帝的修炼历史">
                        <ol className="dep-journey-track">
                            {REALM_JOURNEY.map((realm, index) => {
                                const current = realm.id === "realm-dou-emperor";
                                return (
                                    <li key={realm.id} className={current ? "is-current" : "is-passed"} aria-current={current ? "step" : undefined}>
                                        <span className="dep-journey-index">{String(index + 1).padStart(2, "0")}</span>
                                        <span className="dep-journey-node" aria-hidden="true">
                                            {current ? <Sparkles className="size-4" /> : <span />}
                                        </span>
                                        <strong>{realm.name}</strong>
                                        <small>{current ? "帝境已成" : "已历此境"}</small>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                </section>

                <div className="dep-core-grid">
                    <section className="dep-module dep-law-module" aria-labelledby="law-control-title">
                        <div className="dep-section-heading dep-module-heading">
                            <div>
                                <span>LAW CONTROL</span>
                                <h2 id="law-control-title" className="font-display">
                                    法则掌控
                                </h2>
                            </div>
                            <p>境界授权、系统能力与模型能力共同构成当前可调动的创作法则。</p>
                        </div>

                        <div className="dep-law-layout">
                            <div className="dep-law-core" aria-label={`已掌握 ${capabilities.length} 项能力`}>
                                <div className="dep-law-core-rings" aria-hidden="true">
                                    <span />
                                    <span />
                                    <span />
                                </div>
                                <InfinityIcon aria-hidden="true" />
                                <strong>{capabilities.length}</strong>
                                <span>项法则已掌控</span>
                            </div>

                            <div className="dep-capability-groups">
                                {capabilityGroups.map((group) => (
                                    <div key={group.key} className="dep-capability-group">
                                        <div className="dep-capability-group-heading">
                                            <strong>{group.title}</strong>
                                            <span>{group.subtitle}</span>
                                        </div>
                                        <div className="dep-capability-list">
                                            {group.items.map((capability) => {
                                                const Icon = capability.icon;
                                                return (
                                                    <div key={capability.key} className="dep-capability-row">
                                                        <span className="dep-capability-icon" aria-hidden="true">
                                                            <Icon className="size-4" />
                                                        </span>
                                                        <span className="dep-capability-copy">
                                                            <strong>{capability.label}</strong>
                                                            <small>{capability.detail}</small>
                                                        </span>
                                                        <span className="dep-capability-energy" aria-hidden="true">
                                                            <i />
                                                        </span>
                                                        <span className="dep-capability-state">已掌控</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="dep-module dep-epoch-module" aria-labelledby="creation-epoch-title">
                        <div className="dep-section-heading dep-module-heading">
                            <div>
                                <span>CREATION EPOCH</span>
                                <h2 id="creation-epoch-title" className="font-display">
                                    创作纪元
                                </h2>
                            </div>
                            <p>以真实创作记录呈现你的作品规模、时间沉淀与模型轨迹。</p>
                        </div>

                        <div className="dep-epoch-primary">
                            <span>累计作品</span>
                            <strong>{profile.totalImages.toLocaleString()}</strong>
                            <small>幅作品已写入你的创作纪元</small>
                        </div>

                        <dl className="dep-epoch-metrics">
                            <EpochMetric icon={CalendarDays} label="创作天数" value={`${profile.activeDays.toLocaleString()} 天`} />
                            <EpochMetric icon={Gauge} label="累计修为" value={profile.totalXp.toLocaleString()} />
                            <EpochMetric icon={Aperture} label="掌控能力" value={`${capabilities.length} 项`} />
                            <EpochMetric icon={Activity} label="今日创作" value={`${profile.usedToday.toLocaleString()} 次`} />
                        </dl>

                        <div className="dep-model-usage">
                            <div className="dep-model-visual" style={{ backgroundImage: modelGradient }} aria-hidden="true">
                                <span>
                                    <Cpu className="size-5" />
                                </span>
                            </div>
                            <div className="dep-model-copy">
                                <div className="dep-model-heading">
                                    <div>
                                        <strong>模型使用情况</strong>
                                        <span>{modelUsage.length ? `${modelUsage.length} 个模型留下创作记录` : "尚未形成模型使用记录"}</span>
                                    </div>
                                    <Cpu className="size-4" aria-hidden="true" />
                                </div>
                                {modelUsage.length ? (
                                    <ol className="dep-model-list">
                                        {modelUsage.map((item, index) => {
                                            const percent = totalModelImages ? Math.round((item.images / totalModelImages) * 100) : 0;
                                            return (
                                                <li key={item.model}>
                                                    <span className="dep-model-dot" style={{ backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length] }} aria-hidden="true" />
                                                    <span className="dep-model-name" title={item.model}>
                                                        {formatModelName(item.model)}
                                                    </span>
                                                    <span className="dep-model-bar" aria-hidden="true">
                                                        <i style={{ width: `${percent}%`, backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length] }} />
                                                    </span>
                                                    <strong>{item.images.toLocaleString()} 幅</strong>
                                                </li>
                                            );
                                        })}
                                    </ol>
                                ) : (
                                    <p className="dep-model-empty">完成首批图像创作后，这里会自动形成真实的模型使用分布。</p>
                                )}
                            </div>
                        </div>
                    </section>
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

function fallbackCapabilityMeta(key: string): CapabilityMeta {
    return { label: key, detail: "已由当前境界授权", icon: Sparkles, group: "other" };
}

function formatModelName(model: string) {
    const value = model.trim();
    if (value.length <= 26) return value;
    return `${value.slice(0, 23)}...`;
}

function buildModelGradient(items: CultivationProfile["modelUsage"]) {
    const total = items.reduce((sum, item) => sum + item.images, 0);
    if (!total) return "conic-gradient(from 210deg, rgba(217,185,111,.22), rgba(125,178,216,.08), rgba(217,185,111,.22))";
    let cursor = 0;
    const segments = items.map((item, index) => {
        const start = cursor;
        cursor += (item.images / total) * 100;
        return `${MODEL_COLORS[index % MODEL_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
    return `conic-gradient(from 210deg, ${segments.join(", ")})`;
}
