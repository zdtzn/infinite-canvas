import { memo, useEffect, useMemo, useState } from "react";
import { App, Empty, Input, Select, Spin } from "antd";
import { Eye, FileText, Plus, Search } from "lucide-react";

import { promptImageCandidates, PromptCover } from "@/components/prompts/prompt-cover";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";
import { PROMPT_TAXONOMY } from "@/services/api/prompt-taxonomy";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";

import type { InsertAssetPayload } from "./asset-picker-modal";

const ALL_SOURCES = "all";
const ALL_PRIMARY_CATEGORIES = "all";
const CANVAS_PROMPT_PAGE_SIZE = 30;

function promptIdentity(item: Prompt) {
    return `${item.sourceId || item.category}:${item.id}`;
}

export function mergeCanvasPromptPages(pages: Prompt[][]) {
    const seen = new Set<string>();
    return pages.flatMap((page) =>
        page.filter((item) => {
            const key = promptIdentity(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }),
    );
}

export const CanvasPromptList = memo(function CanvasPromptList({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const sources = usePromptSourceStore((state) => state.sources);
    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);
    const [keyword, setKeyword] = useState("");
    const [sourceId, setSourceId] = useState(ALL_SOURCES);
    const [primaryCategory, setPrimaryCategory] = useState(ALL_PRIMARY_CATEGORIES);
    const [detail, setDetail] = useState<Prompt | null>(null);

    useEffect(() => {
        if (sourceId !== ALL_SOURCES && !enabledSources.some((source) => source.id === sourceId)) setSourceId(ALL_SOURCES);
    }, [enabledSources, sourceId]);

    const { query, total } = usePromptList({
        sourceId: sourceId === ALL_SOURCES ? "" : sourceId,
        keyword,
        tags: primaryCategory === ALL_PRIMARY_CATEGORIES ? [] : [primaryCategory],
        category: ALL_PROMPTS_OPTION,
        pageSize: CANVAS_PROMPT_PAGE_SIZE,
        enabled: enabledSources.length > 0,
    });
    const items = useMemo(() => mergeCanvasPromptPages((query.data?.pages || []).map((page) => page.items)), [query.data?.pages]);

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success("已复制提示词");
        } catch {
            message.error("复制失败");
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="space-y-2 px-3 pb-2.5 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索标题、正文或分类" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                    <Select
                        size="small"
                        value={sourceId}
                        onChange={setSourceId}
                        showSearch
                        optionFilterProp="label"
                        aria-label="筛选提示词来源"
                        options={[{ label: "全部来源", value: ALL_SOURCES }, ...enabledSources.map((source) => ({ label: source.name, value: source.id }))]}
                    />
                    <Select
                        size="small"
                        value={primaryCategory}
                        onChange={setPrimaryCategory}
                        aria-label="筛选主分类"
                        options={[{ label: "全部分类", value: ALL_PRIMARY_CATEGORIES }, ...PROMPT_TAXONOMY.map((category) => ({ label: category, value: category }))]}
                    />
                </div>
                {query.isSuccess ? (
                    <div className="text-[11px] opacity-45">
                        已显示 {items.length} / {total}
                    </div>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {!enabledSources.length ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已启用提示词来源" className="pt-12" />
                ) : query.isPending ? (
                    <div className="flex justify-center py-12">
                        <Spin size="small" />
                    </div>
                ) : query.isError ? (
                    <button type="button" onClick={() => void query.refetch()} className="block w-full py-10 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                        加载失败，点击重试
                    </button>
                ) : items.length ? (
                    <div className="space-y-1.5">
                        {items.map((item) => (
                            <CanvasPromptRow key={promptIdentity(item)} item={item} theme={theme} onInsert={() => onInsert({ kind: "text", content: item.prompt, title: item.title })} onView={() => setDetail(item)} />
                        ))}
                        {query.hasNextPage ? (
                            <button
                                type="button"
                                onClick={() => void query.fetchNextPage()}
                                disabled={query.isFetchingNextPage}
                                className="flex h-9 w-full items-center justify-center rounded-md text-xs font-medium opacity-65 transition hover:bg-black/5 hover:opacity-100 disabled:cursor-wait dark:hover:bg-white/5"
                            >
                                {query.isFetchingNextPage ? <Spin size="small" /> : "加载更多"}
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的提示词" className="pt-12" />
                )}
            </div>

            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} />
        </div>
    );
});

export function CanvasPromptRow({ item, theme, onInsert, onView }: { item: Prompt; theme: CanvasTheme; onInsert: () => void; onView: () => void }) {
    return (
        <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? (
                <PromptCover sources={promptImageCandidates(item.coverUrl, 160)} alt={item.title} className="size-10 shrink-0 rounded-md object-cover [&_span]:hidden [&_svg]:size-4" fetchPriority="low" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                    <FileText className="size-4 opacity-50" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                <div className="mt-0.5 truncate text-[11px] leading-snug opacity-45">{[item.category, item.tags[0]].filter(Boolean).join(" · ")}</div>
                <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label="查看详情" title="查看详情">
                    <Eye className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label="插入画布"
                    title="插入画布"
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
