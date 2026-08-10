import { useMemo, useState } from "react";
import { Empty, Input, Modal, Tabs } from "antd";
import { Image as ImageIcon, Search } from "lucide-react";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { CanvasNodeType } from "@/types/canvas";
import type { ColorAlchemySource } from "./types";
import { ColorSourceImage } from "./color-source-image";

type DialogColorSource = ColorAlchemySource & {
    preview: string;
    previewStorageKey?: string;
    group: string;
};

export function ColorSourceDialog({ open, initialTab, onSelect, onClose }: { open: boolean; initialTab: "assets" | "canvas"; onSelect: (source: ColorAlchemySource) => void; onClose: () => void }) {
    const assets = useAssetStore((state) => state.assets);
    const projects = useCanvasStore((state) => state.projects);
    const [keyword, setKeyword] = useState("");

    const assetSources = useMemo(
        () =>
            assets
                .filter((asset) => asset.kind === "image")
                .map((asset) => ({
                    key: `asset:${asset.id}`,
                    title: asset.title || "未命名作品",
                    url: asset.data.dataUrl,
                    storageKey: asset.data.storageKey,
                    width: asset.data.width,
                    height: asset.data.height,
                    mimeType: asset.data.mimeType,
                    preview: asset.data.thumbnailUrl || asset.coverUrl || asset.data.dataUrl,
                    previewStorageKey: asset.data.thumbnailKey || asset.data.storageKey,
                    group: "藏卷阁",
                })),
        [assets],
    );
    const canvasSources = useMemo(
        () =>
            projects.flatMap((project) =>
                project.nodes
                    .filter((node) => node.type === CanvasNodeType.Image && Boolean(node.metadata?.content))
                    .map((node) => ({
                        key: node.metadata?.storageKey || `canvas:${project.id}:${node.id}`,
                        title: node.title || "画布图片",
                        url: node.metadata!.content!,
                        storageKey: node.metadata?.storageKey,
                        width: node.metadata?.naturalWidth,
                        height: node.metadata?.naturalHeight,
                        mimeType: node.metadata?.mimeType,
                        preview: node.metadata!.content!,
                        previewStorageKey: node.metadata?.storageKey,
                        group: project.title,
                        origin: { route: `/canvas/${project.id}`, projectId: project.id, nodeId: node.id },
                    })),
            ),
        [projects],
    );

    const filtered = (sources: DialogColorSource[]) => {
        const query = keyword.trim().toLowerCase();
        return query ? sources.filter((source) => `${source.title} ${source.group}`.toLowerCase().includes(query)) : sources;
    };

    const renderSources = (sources: DialogColorSource[]) => {
        const visible = filtered(sources);
        return visible.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {visible.map((source) => (
                    <button
                        key={`${source.group}:${source.key}`}
                        type="button"
                        className="group overflow-hidden rounded-md border border-stone-200 bg-white text-left transition hover:border-[#c9a86a] hover:shadow-md dark:border-stone-700 dark:bg-stone-900"
                        onClick={() => {
                            onSelect(source);
                            onClose();
                        }}
                    >
                        <div className="relative aspect-[4/3] overflow-hidden bg-stone-100 dark:bg-stone-800">
                            <ColorSourceImage
                                source={{ storageKey: source.previewStorageKey, url: source.preview }}
                                alt={source.title}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                            />
                            <div className="absolute inset-0 grid place-items-center bg-black/0 text-xs font-medium text-white opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100">送入灵彩</div>
                        </div>
                        <div className="p-2.5">
                            <div className="truncate text-sm font-medium">{source.title}</div>
                            <div className="mt-1 truncate text-xs text-stone-400">{source.group}</div>
                        </div>
                    </button>
                ))}
            </div>
        ) : (
            <Empty image={<ImageIcon className="mx-auto size-10 text-stone-300" />} description="这里还没有可用图片" className="py-14" />
        );
    };

    return (
        <Modal title="选择一张图片" open={open} footer={null} width={940} destroyOnHidden onCancel={onClose} styles={{ body: { minHeight: 500 } }}>
            <Input prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索作品或画布" value={keyword} allowClear onChange={(event) => setKeyword(event.target.value)} className="mb-4" />
            <Tabs
                key={initialTab}
                defaultActiveKey={initialTab}
                items={[
                    { key: "assets", label: `作品库 ${assetSources.length}`, children: renderSources(assetSources) },
                    { key: "canvas", label: `画布图片 ${canvasSources.length}`, children: renderSources(canvasSources) },
                ]}
            />
        </Modal>
    );
}
