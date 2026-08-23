import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import { ALL_PROMPTS_OPTION, fetchPrompts, PROMPT_LIBRARY_UPDATED_EVENT } from "@/services/api/prompts";

export const PROMPT_PAGE_SIZE = 20;

export function usePromptList({ sourceId = "", keyword, tags, category, pageSize = PROMPT_PAGE_SIZE, enabled = true }: { sourceId?: string; keyword: string; tags: string[]; category: string; pageSize?: number; enabled?: boolean }) {
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    const queryClient = useQueryClient();
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    useEffect(() => {
        const refresh = () => void queryClient.invalidateQueries({ queryKey: ["prompts"] });
        window.addEventListener(PROMPT_LIBRARY_UPDATED_EVENT, refresh);
        return () => window.removeEventListener(PROMPT_LIBRARY_UPDATED_EVENT, refresh);
    }, [queryClient]);
    const query = useInfiniteQuery({
        queryKey: ["prompts", sourceId, debouncedKeyword, tags, category, pageSize],
        queryFn: ({ pageParam }) => fetchPrompts({ sourceId, keyword: debouncedKeyword, tag: tags, category, page: pageParam, pageSize }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    });
    const firstPage = query.data?.pages[0];
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        tags: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.tags || [])], [firstPage?.tags]),
        categories: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.categories || [])], [firstPage?.categories]),
        total: firstPage?.total || 0,
        indexed: firstPage?.indexed,
    };
}
