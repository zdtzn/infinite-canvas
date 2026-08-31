import { useMemo, useState } from "react";
import { ImagePlus, Images, Layers3, Trash2 } from "lucide-react";
import { Tabs, Tooltip } from "antd";

import { useAssetStore } from "@/stores/use-asset-store";
import { COLOR_PRESET_CATEGORIES, type ColorAlchemyDocument, type ColorAlchemySource, type ColorPreset, type ColorPresetCategory } from "./types";
import { COLOR_PRESETS } from "./presets";
import { ColorSourceImage } from "./color-source-image";
import { FilmLutLibrary } from "./film-lut-library";

export type ColorSourcePanelTab = "sources" | "presets" | "luts";

export function ColorSourcePanel({
    document,
    documents,
    onSelectDocument,
    onUpload,
    onOpenAssets,
    onOpenCanvas,
    onSelectSource,
    onApplyPreset,
    onApplyLut,
    onRemoveDocument,
    activeTab,
    onTabChange,
}: {
    document: ColorAlchemyDocument;
    documents: ColorAlchemyDocument[];
    onSelectDocument: (id: string) => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    onOpenCanvas: () => void;
    onSelectSource: (source: ColorAlchemySource) => void;
    onApplyPreset: (preset: ColorPreset) => void;
    onApplyLut: (lutFile: string | null) => void;
    onRemoveDocument: (id: string) => void;
    activeTab: ColorSourcePanelTab;
    onTabChange: (tab: ColorSourcePanelTab) => void;
}) {
    const assets = useAssetStore((state) => state.assets);
    const [category, setCategory] = useState<ColorPresetCategory>("电影");
    const recentAssets = useMemo(() => assets.filter((asset) => asset.kind === "image").slice(0, 6), [assets]);
    const presets = COLOR_PRESETS.filter((preset) => preset.category === category);

    return (
        <aside className="color-alchemy-source-panel flex h-full min-h-0 flex-col border-r border-white/8 text-[#eeeae0]">
            <div className="flex h-11 shrink-0 items-center border-b border-white/8 px-4">
                <div className="text-xs font-medium text-white/48">素材与风格</div>
            </div>
            <Tabs
                className="color-alchemy-side-tabs min-h-0 flex-1 px-3"
                activeKey={activeTab}
                onChange={(key) => onTabChange(key as ColorSourcePanelTab)}
                items={[
                    {
                        key: "sources",
                        label: "素材",
                        children: (
                            <div className="thin-scrollbar h-full space-y-5 overflow-y-auto pb-5">
                                <PanelSection title="当前图片">
                                    <div className="group relative overflow-hidden rounded-md border border-[#d7b46a]/42 bg-white/[0.035]" title={document.source.title}>
                                        <div className="aspect-[4/3] overflow-hidden bg-black/20">
                                            <ColorSourceImage source={document.source} alt={document.source.title} className="h-full w-full object-cover" />
                                        </div>
                                        <div className="truncate px-2.5 py-2 text-xs font-medium text-white/85">{document.source.title}</div>
                                        <Tooltip title="移除当前草稿">
                                            <button
                                                type="button"
                                                className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded bg-black/55 text-white/65 transition hover:bg-red-500/80 hover:text-white lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                                                aria-label={`移除当前草稿 ${document.source.title}`}
                                                onClick={() => onRemoveDocument(document.id)}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </Tooltip>
                                    </div>
                                </PanelSection>

                                <div className="grid grid-cols-3 gap-2">
                                    <SourceAction title="添加图片" icon={<ImagePlus className="size-4" />} onClick={onUpload} />
                                    <SourceAction title="作品库" icon={<Images className="size-4" />} onClick={onOpenAssets} />
                                    <SourceAction title="从画布" icon={<Layers3 className="size-4" />} onClick={onOpenCanvas} />
                                </div>

                                {documents.length > 1 ? (
                                    <PanelSection title={`草稿 (${documents.length}/12)`}>
                                        <div className="grid grid-cols-2 gap-2">
                                            {documents
                                                .filter((item) => item.id !== document.id)
                                                .map((item) => (
                                                    <div key={item.id} className="group relative overflow-hidden rounded-md bg-white/4 text-left transition hover:bg-white/8">
                                                        <button type="button" className="block w-full" onClick={() => onSelectDocument(item.id)}>
                                                            <div className="aspect-[4/3] overflow-hidden">
                                                                <ColorSourceImage source={item.source} alt={item.source.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                                                            </div>
                                                            <div className="truncate px-2 py-1.5 text-[11px] text-white/65">{item.source.title}</div>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="absolute right-1 top-1 grid size-6 place-items-center rounded bg-black/55 text-white/65 transition hover:bg-red-500/80 hover:text-white lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                                                            title="移除草稿"
                                                            aria-label={`移除草稿 ${item.source.title}`}
                                                            onClick={() => onRemoveDocument(item.id)}
                                                        >
                                                            <Trash2 className="size-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                        </div>
                                    </PanelSection>
                                ) : null}

                                {recentAssets.length ? (
                                    <PanelSection title="作品库">
                                        <div className="grid grid-cols-2 gap-2">
                                            {recentAssets.map((asset) => {
                                                if (asset.kind !== "image") return null;
                                                return (
                                                    <button
                                                        key={asset.id}
                                                        type="button"
                                                        className="group overflow-hidden rounded-md bg-white/4 text-left transition hover:bg-white/8"
                                                        onClick={() =>
                                                            onSelectSource({
                                                                key: `asset:${asset.id}`,
                                                                title: asset.title,
                                                                url: asset.data.dataUrl,
                                                                storageKey: asset.data.storageKey,
                                                                width: asset.data.width,
                                                                height: asset.data.height,
                                                                mimeType: asset.data.mimeType,
                                                            })
                                                        }
                                                    >
                                                        <div className="aspect-[4/3] overflow-hidden">
                                                            <ColorSourceImage
                                                                source={{ storageKey: asset.data.thumbnailKey || asset.data.storageKey, url: asset.data.thumbnailUrl || asset.coverUrl || asset.data.dataUrl }}
                                                                alt={asset.title}
                                                                loading="lazy"
                                                                decoding="async"
                                                                className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                                                            />
                                                        </div>
                                                        <div className="truncate px-2 py-1.5 text-[11px] text-white/65">{asset.title}</div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </PanelSection>
                                ) : null}
                            </div>
                        ),
                    },
                    {
                        key: "presets",
                        label: "色彩秘卷",
                        children: (
                            <div className="thin-scrollbar h-full overflow-y-auto pb-5">
                                <div className="mb-3 flex gap-3 overflow-x-auto pb-1">
                                    {COLOR_PRESET_CATEGORIES.map((item) => (
                                        <button key={item} type="button" className={`color-source-category ${category === item ? "is-active" : ""}`} onClick={() => setCategory(item)}>
                                            {item}
                                        </button>
                                    ))}
                                </div>
                                <div className="space-y-3">
                                    {presets.map((preset) => (
                                        <button key={preset.id} type="button" className={`color-preset-card group block w-full ${document.settings.preset === preset.id ? "is-active" : ""}`} onClick={() => onApplyPreset(preset)}>
                                            <div className="aspect-[16/9] overflow-hidden bg-black/30">
                                                <ColorSourceImage source={document.source} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" style={{ filter: preset.previewFilter }} />
                                            </div>
                                            <div className="px-3 py-2.5">
                                                <div className="flex items-center gap-2 text-xs font-medium text-white/82">
                                                    <span className="size-2 rounded-full" style={{ background: preset.accent }} />
                                                    {preset.name}
                                                </div>
                                                <div className="mt-1 line-clamp-1 text-[10px] text-white/38">{preset.description}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "luts",
                        label: "胶片滤镜",
                        children: <FilmLutLibrary activeLutId={document.settings.lutId} onApplyLut={onApplyLut} />,
                    },
                ]}
            />
        </aside>
    );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section>
            <div className="mb-2 text-[11px] font-medium tracking-[0.1em] text-white/35">{title}</div>
            {children}
        </section>
    );
}

function SourceAction({ title, icon, onClick }: { title: string; icon: React.ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title}>
            <button
                type="button"
                className="flex h-14 flex-col items-center justify-center gap-1 rounded-md border border-white/8 bg-white/4 text-[10px] text-white/55 transition hover:border-white/18 hover:bg-white/8 hover:text-white/90"
                onClick={onClick}
            >
                {icon}
                <span>{title}</span>
            </button>
        </Tooltip>
    );
}
