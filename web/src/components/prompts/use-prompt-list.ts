import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { ALL_PROMPTS_OPTION, fetchPrompts } from "@/services/api/prompts";
import { PROMPT_TAXONOMY } from "@/services/api/prompt-taxonomy";
import type { PromptMedia, PromptOrder } from "../../../../shared/prompt-library";

export const PROMPT_PAGE_SIZE = 20;
export const promptSortOptions: { value: PromptOrder; label: string }[] = [
    { value: "relevance", label: "相关度优先" },
    { value: "asc", label: "来源顺序 · 升序" },
    { value: "desc", label: "来源顺序 · 降序" },
];
const promptThemes = [ALL_PROMPTS_OPTION, ...PROMPT_TAXONOMY];

type PromptListOptions = {
    sourceId?: string;
    keyword: string;
    tags: string[];
    category: string;
    media?: PromptMedia;
    pageSize?: number;
    enabled?: boolean;
    order?: PromptOrder;
    browseOrder?: Exclude<PromptOrder, "relevance">;
};

export function usePromptList({ sourceId = "", keyword, tags, category, media, pageSize = PROMPT_PAGE_SIZE, enabled = true, order = "relevance", browseOrder = "desc" }: PromptListOptions) {
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    const requestOrder = order === "relevance" && !debouncedKeyword.trim() ? browseOrder : order;
    const query = useInfiniteQuery({
        queryKey: ["prompts", sourceId, debouncedKeyword, tags, category, media, pageSize, requestOrder],
        queryFn: ({ pageParam }) => fetchPrompts({ sourceId, keyword: debouncedKeyword, tag: tags, category, media, page: pageParam, pageSize, order: requestOrder }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    });
    const firstPage = query.data?.pages[0];
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        themes: promptThemes,
        categories: useMemo(() => [...new Set([ALL_PROMPTS_OPTION, ...(firstPage?.categories || []), category])], [firstPage?.categories, category]),
        total: firstPage?.total || 0,
        indexed: firstPage?.indexed,
    };
}
