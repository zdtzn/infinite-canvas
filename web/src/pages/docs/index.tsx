import {
    Bot,
    BookOpen,
    CheckCircle2,
    ChevronRight,
    CircleHelp,
    ExternalLink,
    FileText,
    ImagePlus,
    Images,
    LayoutDashboard,
    ListChecks,
    Maximize2,
    PackageSearch,
    Palette,
    Search,
    Settings2,
    ShieldCheck,
    Sparkles,
    TrendingUp,
    Video,
    X,
    type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { REPOSITORY_URL } from "@/constant/env";
import { cn } from "@/lib/utils";

import { guideSections, searchGuideSections } from "./content";

const sectionIcons: Record<string, LucideIcon> = {
    "getting-started": Sparkles,
    canvas: Maximize2,
    "color-alchemy": Palette,
    "image-workbench": ImagePlus,
    "product-lab": PackageSearch,
    "video-workbench": Video,
    prompts: FileText,
    assets: Images,
    cultivation: TrendingUp,
    configuration: Settings2,
    "admin-console": LayoutDashboard,
    "task-center": ListChecks,
    "canvas-agent": Bot,
    "data-and-account": ShieldCheck,
    faq: CircleHelp,
};

export default function DocsPage() {
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState(guideSections[0].id);
    const visibleSections = useMemo(() => searchGuideSections(query), [query]);
    const activeId = visibleSections.some((section) => section.id === selectedId) ? selectedId : visibleSections[0]?.id || "";

    const scrollToSection = (id: string) => {
        setSelectedId(id);
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
        <main className="h-full overflow-y-auto scroll-smooth bg-background text-foreground">
            <header className="border-b border-stone-200 dark:border-white/10">
                <div className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8 lg:py-12">
                    <div className="flex max-w-3xl items-center gap-2 text-sm font-medium text-[#b44735] dark:text-[#d8b36d]">
                        <BookOpen className="size-4" />
                        Infinite Canvas 帮助中心
                    </div>
                    <h1 className="mt-3 text-3xl font-semibold tracking-normal text-stone-950 sm:text-4xl dark:text-[#f2efe6]">网站使用说明</h1>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-600 sm:text-base dark:text-stone-400">当前指南覆盖丹青台、洞天、灵彩、商品幻境、功法楼、藏卷阁、命宫、Canvas Agent 与掌教殿，并说明模型能力、任务恢复和账号数据的边界。</p>

                    <div className="relative mt-7 max-w-2xl">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="搜索功能、操作或问题，例如：入藏卷阁、比例、任务失败"
                            aria-label="搜索网站使用说明"
                            className="h-11 w-full rounded-md border border-stone-300 bg-white pl-10 pr-11 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-[#b44735] focus:ring-2 focus:ring-[#b44735]/10 dark:border-white/12 dark:bg-white/[0.035] dark:text-[#edede6] dark:focus:border-[#c9a86a] dark:focus:ring-[#c9a86a]/10"
                        />
                        {query ? (
                            <button
                                type="button"
                                onClick={() => setQuery("")}
                                className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-white/8 dark:hover:text-white"
                                aria-label="清空搜索"
                                title="清空搜索"
                            >
                                <X className="size-4" />
                            </button>
                        ) : null}
                    </div>

                    <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                        <Link to="/image" className="inline-flex items-center gap-1.5 font-medium !text-stone-700 transition hover:!text-[#b44735] dark:!text-stone-300 dark:hover:!text-[#d8b36d]">
                            直接生图 <ChevronRight className="size-3.5" />
                        </Link>
                        <Link to="/canvas" className="inline-flex items-center gap-1.5 font-medium !text-stone-700 transition hover:!text-[#b44735] dark:!text-stone-300 dark:hover:!text-[#d8b36d]">
                            打开画布 <ChevronRight className="size-3.5" />
                        </Link>
                        <Link to="/color-alchemy" className="inline-flex items-center gap-1.5 font-medium !text-stone-700 transition hover:!text-[#b44735] dark:!text-stone-300 dark:hover:!text-[#d8b36d]">
                            进入灵彩 <ChevronRight className="size-3.5" />
                        </Link>
                        <Link to="/product-lab" className="inline-flex items-center gap-1.5 font-medium !text-stone-700 transition hover:!text-[#b44735] dark:!text-stone-300 dark:hover:!text-[#d8b36d]">
                            制作商品图 <ChevronRight className="size-3.5" />
                        </Link>
                    </div>
                </div>
            </header>

            {visibleSections.length ? (
                <>
                    <div className="sticky top-0 z-10 border-b border-stone-200 bg-background/95 px-5 py-3 backdrop-blur-lg lg:hidden dark:border-white/10">
                        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400" htmlFor="docs-section-select">
                            当前章节
                        </label>
                        <select
                            id="docs-section-select"
                            value={activeId}
                            onChange={(event) => scrollToSection(event.target.value)}
                            className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-background px-3 text-sm outline-none focus:border-[#b44735] dark:border-white/12 dark:focus:border-[#c9a86a]"
                        >
                            {visibleSections.map((section) => (
                                <option key={section.id} value={section.id}>
                                    {section.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:px-8">
                        <aside className="hidden py-10 lg:block">
                            <nav className="sticky top-6 space-y-1" aria-label="帮助中心目录">
                                <p className="mb-3 px-3 text-xs font-semibold uppercase text-stone-400">使用指南</p>
                                {visibleSections.map((section) => {
                                    const Icon = sectionIcons[section.id] || BookOpen;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => scrollToSection(section.id)}
                                            className={cn(
                                                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition",
                                                activeId === section.id
                                                    ? "bg-stone-100 font-medium text-stone-950 dark:bg-white/8 dark:text-[#f2efe6]"
                                                    : "text-stone-500 hover:bg-stone-50 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/[0.045] dark:hover:text-[#f2efe6]",
                                            )}
                                        >
                                            <Icon className={cn("size-4 shrink-0", activeId === section.id && "text-[#b44735] dark:text-[#d8b36d]")} />
                                            <span className="truncate">{section.label}</span>
                                        </button>
                                    );
                                })}
                            </nav>
                        </aside>

                        <article className="min-w-0 pb-16 lg:max-w-4xl">
                            {visibleSections.map((section, sectionIndex) => {
                                const Icon = sectionIcons[section.id] || BookOpen;
                                return (
                                    <section
                                        key={section.id}
                                        id={section.id}
                                        className={cn("scroll-mt-16 py-10 lg:scroll-mt-6 lg:py-12", sectionIndex < visibleSections.length - 1 && "border-b border-stone-200 dark:border-white/10")}
                                        onMouseEnter={() => setSelectedId(section.id)}
                                    >
                                        <div className="flex items-start gap-4">
                                            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-stone-200 bg-stone-50 text-stone-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-[#d8b36d]">
                                                <Icon className="size-4" />
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold text-[#b44735] dark:text-[#d8b36d]">{section.label}</p>
                                                <h2 className="mt-1 text-2xl font-semibold tracking-normal text-stone-950 dark:text-[#f2efe6]">{section.title}</h2>
                                                <p className="mt-3 text-sm leading-7 text-stone-600 dark:text-stone-400">{section.summary}</p>
                                                {section.path && section.actionLabel ? (
                                                    <Link to={section.path} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium !text-[#a53f30] transition hover:!text-[#74291f] dark:!text-[#d8b36d] dark:hover:!text-[#f0d59a]">
                                                        {section.actionLabel} <ChevronRight className="size-3.5" />
                                                    </Link>
                                                ) : null}
                                            </div>
                                        </div>

                                        <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
                                            {section.blocks.map((block) => (
                                                <div key={block.title} className="border-l-2 border-stone-200 pl-4 dark:border-white/10">
                                                    <h3 className="text-sm font-semibold text-stone-900 dark:text-[#edede6]">{block.title}</h3>
                                                    <ol className="mt-3 space-y-2.5">
                                                        {block.items.map((item, index) => (
                                                            <li key={item} className="flex gap-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
                                                                <span className="mt-0.5 shrink-0 font-mono text-xs text-stone-400 dark:text-stone-500">{String(index + 1).padStart(2, "0")}</span>
                                                                <span>{item}</span>
                                                            </li>
                                                        ))}
                                                    </ol>
                                                    {block.note ? <p className="mt-4 border-t border-stone-200 pt-3 text-xs leading-5 text-stone-500 dark:border-white/10 dark:text-stone-500">{block.note}</p> : null}
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                );
                            })}

                            <footer className="mt-4 flex flex-col gap-4 border-t border-stone-200 pt-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:text-stone-400">
                                <span className="inline-flex items-center gap-2">
                                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-500" />
                                    本页用于普通用户操作说明，开发与部署文档不混入主流程。
                                </span>
                                <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 !text-stone-500 transition hover:!text-stone-950 dark:!text-stone-400 dark:hover:!text-[#f2efe6]">
                                    查看项目源码 <ExternalLink className="size-3.5" />
                                </a>
                            </footer>
                        </article>
                    </div>
                </>
            ) : (
                <section className="mx-auto grid max-w-2xl place-items-center px-6 py-24 text-center">
                    <CircleHelp className="size-8 text-stone-400" />
                    <h2 className="mt-4 text-xl font-semibold text-stone-900 dark:text-[#f2efe6]">没有找到相关说明</h2>
                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">换一个功能名称、页面名称或错误关键词再试。</p>
                    <button type="button" onClick={() => setQuery("")} className="mt-5 text-sm font-medium text-[#a53f30] hover:text-[#74291f] dark:text-[#d8b36d] dark:hover:text-[#f0d59a]">
                        清空搜索
                    </button>
                </section>
            )}
        </main>
    );
}
