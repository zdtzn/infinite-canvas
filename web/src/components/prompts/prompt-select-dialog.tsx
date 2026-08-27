import { Search } from "lucide-react";
import { type UIEvent, useEffect, useState } from "react";
import { App, Empty, Input, Modal, Spin, Tag } from "antd";

import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";
import { PromptCard } from "./prompt-card";
import { usePromptList } from "./use-prompt-list";

export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [previewPrompt, setPreviewPrompt] = useState<Prompt | null>(null);
    const copyText = useCopyText();
    const { query, items, tags: promptTags, categories: promptCategories } = usePromptList({ keyword, tags: selectedTags, category: selectedCategory, enabled: open });
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
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : "获取提示词失败");
    }, [message, query.error, query.isError]);

    useEffect(() => {
        if (!open) setPreviewPrompt(null);
    }, [open]);

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <>
            <Modal title="提示词库" open={open} onCancel={() => onOpenChange(false)} footer={null} width={880} centered>
                <div className="grid h-[62dvh] min-h-0 gap-5 sm:grid-cols-[200px_minmax(0,1fr)]" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                    <aside className="thin-scrollbar min-h-0 overflow-y-auto border-r border-stone-200 pr-4 dark:border-stone-800">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">来源</div>
                        <div className="flex flex-wrap gap-1.5">
                            {promptCategories.map((category) => <Tag.CheckableTag key={category} checked={selectedCategory === category} className={cn("prompt-filter-tag", selectedCategory === category && "is-active")} onChange={() => setSelectedCategory(category)}>{category}</Tag.CheckableTag>)}
                        </div>
                        <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">主题</div>
                        <div className="flex flex-wrap gap-1.5">
                            {promptTags.map((tag) => {
                                const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                return <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag", active && "is-active")} onChange={() => toggleTag(tag)}>{tag}</Tag.CheckableTag>;
                            })}
                        </div>
                    </aside>
                    <section className="flex min-h-0 min-w-0 flex-col">
                        <Input size="large" prefix={<Search className="size-4 text-stone-400" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="按标题查询" />
                        <div className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2" data-canvas-no-zoom onScroll={handleListScroll} onWheelCapture={(event) => event.stopPropagation()}>
                            {query.isLoading ? <div className="flex h-40 items-center justify-center"><Spin /></div> : null}
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                {items.map((item) => <PromptCard key={item.id} item={item} onOpen={() => setPreviewPrompt(item)} onCopy={() => setPreviewPrompt(item)} compact />)}
                            </div>
                            {!query.isLoading && items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的提示词" className="py-8" /> : null}
                            {query.isFetchingNextPage ? <div className="py-4 text-center"><Spin size="small" /></div> : null}
                        </div>
                    </section>
                </div>
            </Modal>
            <PromptDetailDialog
                prompt={previewPrompt}
                onClose={() => setPreviewPrompt(null)}
                onCopy={(prompt) => copyText(prompt, "提示词已复制")}
                onUse={selectPrompt}
            />
        </>
    );
}
