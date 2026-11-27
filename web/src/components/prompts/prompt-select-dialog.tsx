import { Search } from "lucide-react";
import { type UIEvent, useEffect, useRef, useState } from "react";
import { App, Empty, Input, Modal, Select, Spin } from "antd";

import { useCopyText } from "@/hooks/use-copy-text";
import { userFacingErrorMessage } from "@/lib/friendly-error";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";
import type { PromptMedia, PromptOrder } from "../../../../shared/prompt-library";
import { PromptCard } from "./prompt-card";
import { PromptFilter } from "./prompt-filter";
import { PromptWindowGrid } from "./prompt-window-grid";
import { promptSortOptions, usePromptList } from "./use-prompt-list";

export function PromptSelectDialog({ open, onOpenChange, onSelect, media }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void; media?: PromptMedia }) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [order, setOrder] = useState<PromptOrder>("relevance");
    const listRef = useRef<HTMLDivElement>(null);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [previewPrompt, setPreviewPrompt] = useState<Prompt | null>(null);
    const copyText = useCopyText();
    const { query, items, themes, categories: promptCategories } = usePromptList({ keyword, tags: selectedTags, category: selectedCategory, media, order, browseOrder: "asc", enabled: open });
    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items[0] === tag ? [] : [tag]));
    };
    const selectPrompt = (item: Prompt) => {
        setPreviewPrompt(null);
        onSelect(item.prompt);
        onOpenChange(false);
    };

    useEffect(() => {
        if (query.isError) message.error(userFacingErrorMessage(query.error, "暂时无法读取提示词，请稍后再试"));
    }, [message, query.error, query.isError]);

    useEffect(() => {
        if (!open) setPreviewPrompt(null);
    }, [open]);

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetching && !query.isError && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [order, keyword, selectedCategory, selectedTags]);

    return (
        <>
            <Modal title="提示词库" open={open} onCancel={() => onOpenChange(false)} footer={null} width={880} centered>
                <div className="grid h-[62dvh] min-h-0 gap-5 sm:grid-cols-[200px_minmax(0,1fr)]" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                    <aside className="thin-scrollbar min-h-0 space-y-5 overflow-y-auto border-r border-stone-200 pr-4 dark:border-stone-800">
                        <PromptFilter label="来源" options={promptCategories} selected={selectedCategory} onChange={setSelectedCategory} />
                        <PromptFilter label="主题" options={themes} selected={selectedTags[0] || ALL_PROMPTS_OPTION} onChange={toggleTag} />
                    </aside>
                    <section className="flex min-h-0 min-w-0 flex-col">
                        <div className="flex flex-wrap gap-3">
                            <Input size="large" aria-label="搜索提示词" className="min-w-40 flex-1" prefix={<Search className="size-4 text-stone-400" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题、内容或主题" />
                            <Select
                                size="large"
                                aria-label="提示词排序"
                                value={order}
                                onChange={setOrder}
                                className="w-44"
                                options={promptSortOptions}
                            />
                        </div>
                        <div ref={listRef} className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2" data-canvas-no-zoom onScroll={handleListScroll} onWheelCapture={(event) => event.stopPropagation()}>
                            {query.isLoading ? (
                                <div className="flex h-40 items-center justify-center">
                                    <Spin />
                                </div>
                            ) : null}
                            <PromptWindowGrid
                                items={items}
                                scrollRef={listRef}
                                active={open}
                                compact
                                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                                renderItem={(item) => <PromptCard item={item} onOpen={() => setPreviewPrompt(item)} onCopy={() => setPreviewPrompt(item)} compact />}
                            />
                            {!query.isLoading && items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的提示词" className="py-8" /> : null}
                            {query.isFetchingNextPage ? (
                                <div className="py-4 text-center">
                                    <Spin size="small" />
                                </div>
                            ) : null}
                        </div>
                    </section>
                </div>
            </Modal>
            <PromptDetailDialog prompt={previewPrompt} onClose={() => setPreviewPrompt(null)} onCopy={(prompt) => copyText(prompt, "提示词已复制")} onUse={selectPrompt} />
        </>
    );
}
