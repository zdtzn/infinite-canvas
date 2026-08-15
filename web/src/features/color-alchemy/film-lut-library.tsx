import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";

import { filmLutCategoryLabel, loadFilmLutCatalog, staticFilmLutUrl, type FilmLutEntry } from "./film-lut";

const INITIAL_VISIBLE_COUNT = 48;

export function FilmLutLibrary({ activeLutId, onApplyLut }: { activeLutId: string | null; onApplyLut: (lutFile: string | null) => void }) {
    const [catalog, setCatalog] = useState<FilmLutEntry[]>([]);
    const [category, setCategory] = useState("全部");
    const [query, setQuery] = useState("");
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    useEffect(() => {
        let active = true;
        void loadFilmLutCatalog()
            .then((items) => {
                if (active) setCatalog(items);
            })
            .catch((reason) => {
                if (active) setError(reason instanceof Error ? reason.message : "胶片滤镜清单加载失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const categories = useMemo(() => ["全部", ...Array.from(new Set(catalog.map((item) => item.category)))], [catalog]);
    const filtered = useMemo(
        () =>
            catalog.filter((item) => {
                if (category !== "全部" && item.category !== category) return false;
                return !deferredQuery || `${item.name} ${item.category}`.toLowerCase().includes(deferredQuery);
            }),
        [catalog, category, deferredQuery],
    );
    const visible = filtered.slice(0, visibleCount);

    useEffect(() => {
        setVisibleCount(INITIAL_VISIBLE_COUNT);
    }, [category, deferredQuery]);

    return (
        <div className="thin-scrollbar h-[calc(100vh-150px)] overflow-y-auto pb-5">
            <div className="sticky top-0 z-10 space-y-2 bg-[#151719]/96 pb-3 pt-1 backdrop-blur-xl">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-white/45">{catalog.length ? `${filtered.length} 款胶片滤镜` : "胶片滤镜"}</span>
                    {activeLutId ? (
                        <button type="button" className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-white/55 transition hover:bg-white/8 hover:text-white" onClick={() => onApplyLut(null)}>
                            <X className="size-3" />
                            清除
                        </button>
                    ) : null}
                </div>
                <label className="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 text-white/45 focus-within:border-[#d7b46a]/55">
                    <Search className="size-3.5 shrink-0" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索胶片名称" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30" />
                </label>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {categories.map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={`shrink-0 rounded px-2 py-1 text-[10px] transition ${category === item ? "bg-[#d7b46a] text-[#17130c]" : "bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/85"}`}
                            onClick={() => setCategory(item)}
                        >
                            {item === "全部" ? item : filmLutCategoryLabel(item)}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-xs text-white/45">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在展开胶片滤镜
                </div>
            ) : error ? (
                <div className="rounded-md border border-red-300/20 bg-red-950/25 px-3 py-4 text-xs text-red-100">{error}</div>
            ) : visible.length ? (
                <>
                    <div className="grid grid-cols-2 gap-2">
                        {visible.map((item) => {
                            const selected = item.lutFile === activeLutId;
                            return (
                                <button
                                    key={item.lutFile}
                                    type="button"
                                    aria-pressed={selected}
                                    className={`group overflow-hidden rounded-md border text-left transition ${selected ? "border-[#d7b46a]" : "border-white/8 hover:border-white/25"}`}
                                    onClick={() => onApplyLut(item.lutFile)}
                                >
                                    <div className="relative aspect-[4/3] overflow-hidden bg-black/25">
                                        <img src={staticFilmLutUrl(item.thumbnail)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                                        {selected ? <span className="absolute right-1.5 top-1.5 rounded bg-[#d7b46a] px-1.5 py-0.5 text-[9px] font-semibold text-[#17130c]">已选</span> : null}
                                    </div>
                                    <div className="truncate px-2 py-1.5 text-[10px] text-white/72" title={item.name}>
                                        {item.name}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    {visible.length < filtered.length ? (
                        <button type="button" className="mt-3 h-8 w-full rounded-md border border-white/10 text-xs text-white/55 transition hover:border-white/25 hover:bg-white/5 hover:text-white" onClick={() => setVisibleCount((value) => value + INITIAL_VISIBLE_COUNT)}>
                            加载更多
                        </button>
                    ) : null}
                </>
            ) : (
                <div className="py-12 text-center text-xs text-white/40">没有找到匹配的胶片滤镜</div>
            )}
        </div>
    );
}
