import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Modal, Pagination, Tag } from "antd";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useUserStore } from "@/stores/use-user-store";
import { fetchServerAssetLibrary } from "@/services/server-api";
import { assetFacets, matchesAssetFilters } from "@/lib/asset-filters";
import { AssetFilterControls } from "@/components/assets/asset-filter-controls";

import { cn } from "@/lib/utils";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

export type InsertAssetPayload =
    { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number };

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    return (
        <Modal title="选择藏卷阁内容" open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}>
            {open ? <MyAssetsTab onInsert={onInsert} /> : null}
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

function PickerCard({ title, kind, cover, onClick }: { title: string; kind: string; cover: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
            onClick={onClick}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{title}</span>
                    <Tag className="m-0 shrink-0 text-[10px]">{kind === "image" ? "图片" : kind === "video" ? "视频" : "文本"}</Tag>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">插入</div>
        </button>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const assets = useAssetStore((state) => state.assets);
    const userId = useUserStore((state) => state.user?.id || "");
    const remote = PUBLIC_MODE && Boolean(userId);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [category, setCategory] = useState<string | undefined>();
    const [tags, setTags] = useState<string[]>([]);
    const query = useQuery({
        queryKey: ["asset-picker", userId, page, keyword, kindFilter, category, tags],
        enabled: remote,
        queryFn: ({ signal }) => fetchServerAssetLibrary(userId, { page, pageSize: PAGE_SIZE, keyword, kind: kindFilter, category, tags, signal }),
    });
    const localFacets = useMemo(() => assetFacets(assets), [assets]);

    const filtered = useMemo(() => {
        return assets.filter((a) => a.kind === "text" || a.kind === "image" || a.kind === "video").filter((a) => matchesAssetFilters(a, { keyword, kind: kindFilter, category, tags }));
    }, [assets, keyword, kindFilter, category, tags]);

    const visible = remote ? query.data?.items || [] : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const total = remote ? query.data?.total || 0 : filtered.length;

    useEffect(() => {
        if (remote) return;
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length, remote]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title });
        } else {
            onInsert(
                asset.kind === "video"
                    ? { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height }
                    : { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title },
            );
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5 text-stone-400" />}
                    placeholder="搜索藏卷阁"
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <div className="flex gap-1.5">
                    {kindOptions.map((opt) => (
                        <Tag.CheckableTag
                            key={opt.value}
                            checked={kindFilter === opt.value}
                            className={cn("prompt-filter-tag", kindFilter === opt.value && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(opt.value);
                            }}
                        >
                            {opt.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            <AssetFilterControls
                facets={remote ? query.data?.facets || { categories: [], tags: [], total: 0, uncategorized: 0 } : localFacets}
                category={category}
                tags={tags}
                onChange={(nextCategory, nextTags) => {
                    setCategory(nextCategory);
                    setTags(nextTags);
                    setPage(1);
                }}
            />
            {remote && query.isFetching ? <p role="status">正在读取素材…</p> : null}
            {remote && query.isError ? (
                <div role="alert">
                    素材加载失败{" "}
                    <Button type="text" onClick={() => void query.refetch()}>
                        重试
                    </Button>
                </div>
            ) : null}
            {visible.length ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")} onClick={() => handleInsert(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="藏卷阁暂无内容" className="py-12" />
            )}

            {total > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}
