import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("prompt picker exposes both orders and forwards order to the paginated query", () => {
    const source = readFileSync(new URL("./prompt-select-dialog.tsx", import.meta.url), "utf8");
    expect(source).toContain('useState<"asc" | "desc">("asc")');
    expect(source).toMatch(/usePromptList\(\{[^}]*order,[^}]*enabled: open/);
    expect(source).toContain('aria-label="提示词排序"');
    expect(source).toContain('value: "asc", label: "来源顺序 · 升序"');
    expect(source).toContain('value: "desc", label: "来源顺序 · 降序"');
    expect(source).toContain("listRef.current.scrollTop = 0");
    expect(source).toContain("!query.isFetching && !query.isError");
    const hook = readFileSync(new URL("./use-prompt-list.ts", import.meta.url), "utf8");
    expect(hook).toMatch(/queryKey: \[[^\n]*order\]/);
    expect(hook).toMatch(/fetchPrompts\(\{[^}]*order\s*\}/);
});
