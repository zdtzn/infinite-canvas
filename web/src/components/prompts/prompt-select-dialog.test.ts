import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PROMPT_TAXONOMY } from "@/services/api/prompt-taxonomy";
import { PromptFilter } from "./prompt-filter";
import { promptSortOptions, usePromptList } from "./use-prompt-list";

test("prompt picker supports relevance, source order and media-specific pagination", () => {
    const source = readFileSync(new URL("./prompt-select-dialog.tsx", import.meta.url), "utf8");
    expect(source).toContain('useState<PromptOrder>("relevance")');
    expect(source).toMatch(/usePromptList\(\{[^}]*media,\s*order,[^}]*enabled: open/);
    expect(source).toContain('aria-label="提示词排序"');
    expect(source).toContain("options={promptSortOptions}");
    expect(promptSortOptions).toEqual([
        { value: "relevance", label: "相关度优先" },
        { value: "asc", label: "来源顺序 · 升序" },
        { value: "desc", label: "来源顺序 · 降序" },
    ]);
    expect(source).toContain("listRef.current.scrollTop = 0");
    expect(source).toContain("!query.isFetching && !query.isError");
    const hook = readFileSync(new URL("./use-prompt-list.ts", import.meta.url), "utf8");
    expect(hook).toMatch(/queryKey: \[[^\n]*media,[^\n]*requestOrder\]/);
    expect(hook).toMatch(/fetchPrompts\(\{[^}]*media,[^}]*order: requestOrder\s*\}/);
});

test("the filters retain the active source and theme without result facets", () => {
    const activeTheme = "自然风景";
    const activeSource = "测试来源";
    function Filters() {
        const { categories, themes } = usePromptList({ keyword: "匹配不到的关键词", tags: [activeTheme], category: activeSource, enabled: false });
        return createElement(Fragment, null,
            createElement(PromptFilter, { label: "来源", options: categories, selected: activeSource, onChange: () => undefined }),
            createElement(PromptFilter, { label: "主题", options: themes, selected: activeTheme, onChange: () => undefined }),
        );
    }

    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Filters)));
    expect(html).toContain(">全部来源</button>");
    expect(html).toContain(">全部主题</button>");
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>测试来源<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>自然风景<\/button>/);
    for (const theme of PROMPT_TAXONOMY) expect(html).toContain(`>${theme}</button>`);
});
