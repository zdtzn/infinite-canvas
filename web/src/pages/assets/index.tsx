import { Copy, Download, Eye, PencilLine, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { saveAs } from "file-saver";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { assetCardImageUrl, assetOriginalImageUrl } from "@/lib/asset-image";
import { uploadImage } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

const kindLabels: Record<string, string> = { image: "图片", video: "视频", text: "文本" };

/**
 * 藏卷阁 · 作品库(方案B「山海境」)
 * 资产增删改查 / 导入导出 / 分页 / 详情抽屉逻辑零改动,仅重做呈现:
 * 螺旋山谷阁头 + 画轴卡片 + hover 浮现操作层。
 */
export default function AssetsPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: "手动添加", note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error("请选择图片文件");
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? "资产已更新" : "资产已保存");
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, thumbnailKey: image.thumbnailKey, thumbnailUrl: image.thumbnailUrl, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, "文本已复制");
    };

    const downloadImage = (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        saveAs(asset.kind === "video" ? asset.data.url : asset.data.dataUrl, `${asset.title || "asset"}.${asset.data.mimeType.split("/")[1] || "png"}`);
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning("暂无资产可导出");
            return;
        }
        await exportAssets(validAssets);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(`已导入 ${importedAssets.length} 个资产`);
        } catch (error) {
            message.error(error instanceof Error ? `导入失败：${error.message}` : "导入失败，请选择有效的资产压缩包");
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success("资产已删除");
        setDeletingAsset(null);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto">
                {/* ── 阁头:螺旋山谷 ── */}
                <section className="relative overflow-hidden">
                    <img src="/images/ref/spiral-valley-1.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-b from-[#0e0e12]/78 via-[#0e0e12]/58 to-[#0e0e12]" aria-hidden />
                    <div className="relative mx-auto max-w-7xl px-6 pb-12 pt-14">
                        <p className="shj-hero-eyebrow">Cang Juan Ge</p>
                        <h1 className="font-brush mt-4 text-5xl text-[#edede6] [text-shadow:0_2px_24px_rgb(0_0_0/0.6)] sm:text-6xl">藏卷阁</h1>
                        <p className="font-display mt-3 text-sm tracking-[0.15em] text-[#edede6]/70">珍藏 {validAssets.length} 卷 · 每一卷,都是一次万象落笔</p>
                    </div>
                </section>

                <div className="mx-auto max-w-7xl px-6 pb-10">
                    {/* ── 检索与行动 ── */}
                    <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <Input.Search
                            className="w-full max-w-xl"
                            size="large"
                            allowClear
                            prefix={<Search className="size-4 text-stone-400" />}
                            value={keyword}
                            placeholder="搜索标题、内容、标签或来源"
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                            onSearch={(value) => {
                                setPage(1);
                                setKeyword(value);
                            }}
                        />
                        <div className="flex flex-wrap items-center gap-4">
                            <button
                                type="button"
                                className="asset-transfer-button inline-flex h-10 items-center gap-2 rounded-md border border-[rgb(201_168_106/0.16)] bg-white/[0.025] px-3 text-sm font-medium text-[#c9c4b9] transition-[color,background-color,border-color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a86a]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0e12]"
                                onClick={() => void exportAllAssets()}
                            >
                                <Download className="size-4 text-[#8a8a96] transition-colors duration-200" aria-hidden />
                                导出资产
                            </button>
                            <button
                                type="button"
                                className="asset-transfer-button inline-flex h-10 items-center gap-2 rounded-md border border-[rgb(201_168_106/0.16)] bg-white/[0.025] px-3 text-sm font-medium text-[#c9c4b9] transition-[color,background-color,border-color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a86a]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0e12]"
                                onClick={() => assetInputRef.current?.click()}
                            >
                                <Upload className="size-4 text-[#8a8a96] transition-colors duration-200" aria-hidden />
                                导入资产
                            </button>
                            <button type="button" onClick={openCreate} className="inline-flex items-center rounded-md bg-[#d8402a] px-5 py-2.5 text-sm font-medium tracking-[0.1em] text-[#fff7ee] transition-colors duration-300 hover:bg-[#ee5038]">
                                新增资产
                            </button>
                        </div>
                    </div>

                    <div className="mt-5 flex items-center gap-3">
                        <span className="text-xs tracking-[0.2em] text-[#8a8a96]">类型</span>
                        <div className="flex flex-wrap gap-2">
                            {kindOptions.map((option) => (
                                <Tag.CheckableTag
                                    key={option.value}
                                    checked={kindFilter === option.value}
                                    className={cn("prompt-filter-tag", kindFilter === option.value && "is-active")}
                                    onChange={() => {
                                        setPage(1);
                                        setKindFilter(option.value as AssetKind | "all");
                                    }}
                                >
                                    {option.label}
                                </Tag.CheckableTag>
                            ))}
                        </div>
                    </div>
                    <hr className="shj-gold-hairline mt-6" />
                </div>

                {/* ── 画轴瀑布 ── */}
                <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 pb-12">
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset, index) => (
                            <AssetScrollCard key={asset.id} asset={asset} priority={index === 0} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />
                        ))}
                    </div>

                    {!visibleAssets.length &&
                        (validAssets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-5 py-24 text-center">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="font-display text-sm tracking-[0.1em] text-[#8a8a96]">阁中尚无一卷,落笔即是开山之作</span>} />
                                <button
                                    type="button"
                                    onClick={openCreate}
                                    className="shj-cta-glow inline-flex items-center rounded-md bg-[#d8402a] px-6 py-3 text-sm font-medium tracking-[0.15em] text-[#fff7ee] transition-colors duration-300 hover:bg-[#ee5038]"
                                >
                                    收入第一卷
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="font-display text-sm tracking-[0.1em] text-[#8a8a96]">此格暂无藏卷</span>} />
                                <Button
                                    onClick={() => {
                                        setKeyword("");
                                        setKindFilter("all");
                                    }}
                                >
                                    清除筛选条件
                                </Button>
                            </div>
                        ))}

                    {filteredAssets.length > pageSize ? (
                        <div className="flex justify-center">
                            <Pagination
                                current={page}
                                pageSize={pageSize}
                                total={filteredAssets.length}
                                showSizeChanger
                                pageSizeOptions={[10, 20, 50, 100]}
                                onChange={(nextPage, nextPageSize) => {
                                    setPage(nextPage);
                                    setPageSize(nextPageSize);
                                }}
                            />
                        </div>
                    ) : null}
                </div>
            </main>

            <Modal
                title={editingAsset ? "编辑资产" : "新增资产"}
                open={isAssetOpen}
                width={980}
                centered
                styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowX: "hidden", overflowY: "auto" } }}
                onCancel={() => setIsAssetOpen(false)}
                onOk={() => void saveAsset()}
                okText="保存"
                cancelText="取消"
                destroyOnHidden
            >
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label="类型">
                            <Select
                                options={[
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                            <Input size="large" placeholder="给资产起一个容易检索的名字" />
                        </Form.Item>
                        <Form.Item name="coverUrl" label="封面 URL">
                            <Space.Compact className="w-full">
                                <Input placeholder="可粘贴图片 URL，也可以上传本地封面" />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    上传
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入标签后回车" />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label="来源">
                                <Input placeholder="手动添加 / 画布 / 提示词库" />
                            </Form.Item>
                            <Form.Item name="note" label="备注">
                                <Input placeholder="可选" />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}>
                                <Input.TextArea rows={8} placeholder="保存提示词、说明文案、参考描述等文本资产" />
                            </Form.Item>
                        ) : (
                            <Form.Item label="图片内容" required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        选择图片文件
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            未选择图片
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>预览</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || "暂无封面"}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || "未命名资产"}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">未打标签</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title="删除资产" open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除「{deletingAsset?.title}」吗？删除后会从我的资产中移除。
            </Modal>
        </div>
    );
}

/** 画轴卡片:封面 + hover 浮现操作层 + 落款条 */
function AssetScrollCard({ asset, priority, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; priority: boolean; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const cover = assetCardImageUrl(asset);
    const summary = assetSummary(asset);
    const actions: { key: string; label: string; icon: typeof Eye; run: () => void; danger?: boolean }[] = [
        { key: "open", label: "查看", icon: Eye, run: onOpen },
        ...(asset.kind !== "video" ? [{ key: "edit", label: "编辑", icon: PencilLine, run: onEdit }] : []),
        ...(asset.kind === "text" ? [{ key: "copy", label: "复制", icon: Copy, run: () => void onCopy(asset) }] : []),
        ...(asset.kind === "image" || asset.kind === "video" ? [{ key: "download", label: "下载", icon: Download, run: () => onDownload(asset) }] : []),
        { key: "delete", label: "删除", icon: Trash2, run: onDelete, danger: true },
    ];

    return (
        <div className="shj-panel group overflow-hidden !rounded-lg">
            <div className="relative">
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-[#17171d] p-5 text-center text-sm leading-6 text-[#c9c4b9]">{asset.kind === "text" ? asset.data.content : "暂无封面"}</div>
                    )}
                </button>
                <div className="pointer-events-none absolute inset-0 flex items-end justify-end gap-2 bg-gradient-to-t from-[#0e0e12]/85 via-transparent to-transparent p-3 opacity-100 transition-opacity duration-300 md:items-center md:justify-center md:bg-[#0e0e12]/74 md:opacity-0 md:backdrop-blur-[2px] md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                    {actions.map((action) => {
                        const ActionIcon = action.icon;
                        return (
                            <button
                                type="button"
                                key={action.key}
                                title={action.label}
                                aria-label={action.label}
                                className={cn(
                                    "pointer-events-auto grid size-9 place-items-center rounded-md border bg-[#17171d]/90 transition-colors md:size-10",
                                    action.danger ? "border-[rgb(216_64_42/0.5)] text-[#ee5038] hover:bg-[#d8402a] hover:text-[#fff7ee]" : "border-[rgb(237_237_230/0.28)] text-[#edede6] hover:border-[#c9a86a]/70 hover:text-[#c9a86a]",
                                )}
                                onClick={action.run}
                            >
                                <ActionIcon className="size-4" />
                            </button>
                        );
                    })}
                </div>
            </div>
            {/* 落款条 */}
            <button type="button" className="block w-full p-4 text-left" onClick={onOpen}>
                <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display line-clamp-1 text-sm tracking-[0.05em] text-[#edede6]">{asset.title}</h2>
                    <span className="shrink-0 rounded border border-[rgb(237_237_230/0.18)] px-1.5 py-0.5 text-[11px] text-[#8a8a96]">{kindLabels[asset.kind]}</span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-[2rem] text-xs leading-4 text-[#8a8a96]">{summary}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-[#8a8a96]/80">{asset.source || "未标注来源"}</span>
                    {(asset.tags || []).slice(0, 2).map((tag) => (
                        <span key={tag} className="rounded border border-[rgb(201_168_106/0.3)] px-1.5 py-0.5 text-[11px] text-[#c9a86a]">
                            {tag}
                        </span>
                    ))}
                </div>
            </button>
        </div>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const cover = asset ? assetOriginalImageUrl(asset) : "";
    return (
        <Drawer title="资产详情" open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={cover} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : "暂无封面"}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "文本"}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text type="secondary" className="block text-xs">
                            内容
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">备注</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                复制文本
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? "下载视频" : "下载图片"}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
