import { FolderPlus, Search } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { App, Button, Empty, Input, Spin, Tag } from "antd";

import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory });

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : "获取提示词失败");
        }
    }, [message, query.error, query.isError]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items[0] === tag ? [] : [tag]));
    };

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success("已加入我的资产");
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) {
            void query.fetchNextPage();
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto" onScroll={handleListScroll}>
                {/* ── 功法楼 · 场景阁头(仅 UI,逻辑不变) ── */}
                <section className="relative overflow-hidden">
                    <img src="/images/ref/misty-dawn.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-b from-[#0e0e12]/78 via-[#0e0e12]/55 to-[#0e0e12]" aria-hidden />
                    <div className="relative mx-auto max-w-7xl px-6 pb-10 pt-14 text-center">
                        <p className="shj-hero-eyebrow inline-flex">Gong Fa Lou</p>
                        <h1 className="font-brush mt-4 text-5xl text-[#edede6] [text-shadow:0_2px_24px_rgb(0_0_0/0.6)] sm:text-6xl">功法楼</h1>
                        <p className="font-display mt-3 text-sm tracking-[0.15em] text-[#edede6]/70">楼藏功法 {totalPrompts} 卷 · 每一卷,皆可助你落笔成象</p>
                    </div>
                </section>

                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
                    <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
                        <aside className="thin-scrollbar max-h-72 overflow-y-auto border-b border-stone-200 pb-5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6rem)] lg:border-b-0 lg:border-r lg:pb-8 lg:pr-5 dark:border-stone-800">
                            <PromptFilter label="来源" options={promptCategoryOptions} selected={selectedCategory} onChange={setSelectedCategory} />
                            <div className="mt-6">
                                <div className="mb-2 text-xs font-semibold text-stone-400 dark:text-stone-500">主题</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {promptTags.map((tag) => {
                                        const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                        return (
                                            <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag", active && "is-active")} onChange={() => toggleTag(tag)}>
                                                {tag}
                                            </Tag.CheckableTag>
                                        );
                                    })}
                                </div>
                            </div>
                        </aside>
                        <section className="min-w-0">
                            <Input size="large" prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} placeholder="搜索标题、内容或主题" onChange={(event) => setTitleKeyword(event.target.value)} />
                            {query.isLoading ? (
                                <div className="flex h-60 items-center justify-center">
                                    <Spin />
                                </div>
                            ) : (
                                <div className="mt-5">
                                    <PromptGrid
                                        items={promptItems}
                                        onOpen={setSelectedPrompt}
                                        onCopy={(item) => copyText(item.prompt, "提示词已复制")}
                                        renderActions={(item) => (
                                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                                加入资产
                                            </Button>
                                        )}
                                    />
                                </div>
                            )}
                            <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">{query.isFetchingNextPage ? "加载中..." : query.hasNextPage ? "继续向下滚动加载更多" : promptItems.length > 0 ? "已经到底了" : null}</div>
                        </section>
                    </div>
                </div>
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, "提示词已复制")} onSaveAsset={savePromptAsset} />
        </div>
    );
}

function PromptFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string; onChange: (value: string) => void }) {
    return (
        <div>
            <div className="mb-2 text-xs font-semibold text-stone-400 dark:text-stone-500">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <Tag.CheckableTag key={option} checked={selected === option} className={cn("prompt-filter-tag", selected === option && "is-active")} onChange={() => onChange(option)}>
                        {option}
                    </Tag.CheckableTag>
                ))}
            </div>
        </div>
    );
}

function PromptGrid({ items, onOpen, onCopy, renderActions }: { items: Prompt[]; onOpen: (item: Prompt) => void; onCopy: (item: Prompt) => void; renderActions: (item: Prompt) => ReactNode }) {
    return (
        <div>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                    <PromptCard key={`${item.category}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />
                ))}
            </div>
            {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的提示词" className="py-16" /> : null}
        </div>
    );
}
