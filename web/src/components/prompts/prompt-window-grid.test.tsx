import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Prompt } from "@/services/api/prompts";
import { PromptWindowGrid } from "./prompt-window-grid";
import { promptGridScrollTop, promptRowOffsets, promptWindowRange, promptWindowRows } from "./prompt-window-range";

describe("prompt row window", () => {
    test("empty lists and partial final rows", () => {
        expect(promptWindowRange([0], 0, 600)).toEqual({ start: 0, end: 0 });
        const offsets = promptRowOffsets(Math.ceil(20 / 3), 300, 20, new Map());
        expect(offsets).toHaveLength(8);
        expect(offsets.at(-1)! - 20).toBe(2220);
        expect(promptWindowRange(offsets, 2000, 600)).toEqual({ start: 4, end: 7 });
    });

    test("variable row heights and exact boundaries", () => {
        const offsets = promptRowOffsets(
            4,
            100,
            10,
            new Map([
                [1, 250],
                [3, 150],
            ]),
        );
        expect(offsets).toEqual([0, 110, 370, 480, 640]);
        expect(promptWindowRange(offsets, 110, 200, 0)).toEqual({ start: 1, end: 2 });
        expect(promptWindowRange(offsets, 370, 100, 0)).toEqual({ start: 2, end: 3 });
    });

    test("scroll coordinates include headers, nested containers, and borders", () => {
        // Grid starts 500px into a scroller at viewport y=100, with a 2px border.
        expect(promptGridScrollTop(700, 100, 2, -98)).toBe(200);
        expect(promptGridScrollTop(0, 100, 2, 602)).toBe(-500);
        expect(promptGridScrollTop(700, 250, 2, 52)).toBe(200);
        expect(promptWindowRange([0, 320, 640, 960], -500, 600, 0)).toEqual({ start: 0, end: 1 });
    });

    test("large jumps, append, and shortened search results stay bounded", () => {
        const offsets = promptRowOffsets(10000, 300, 20, new Map());
        const range = promptWindowRange(offsets, 1600000, 640);
        expect(range).toEqual({ start: 4998, end: 5005 });
        const appended = promptRowOffsets(10020, 300, 20, new Map());
        expect(promptWindowRange(appended, 1600000, 640)).toEqual(range);
        expect(promptWindowRange([0, 320, 640], 1600000, 640)).toEqual({ start: 0, end: 2 });
    });

    test("one focused row stays mounted without expanding the intervening window", () => {
        expect(promptWindowRows(4998, 5005, 0, 10000)).toEqual([0, 4998, 4999, 5000, 5001, 5002, 5003, 5004]);
        expect(promptWindowRows(0, 3, 1, 3)).toEqual([0, 1, 2]);
        expect(promptWindowRows(0, 0, 99, 0)).toEqual([]);
    });

    test("responsive regrouping retains every item including the final partial row", () => {
        for (const columns of [1, 2, 3, 4]) {
            const count = Math.ceil(101 / columns);
            const offsets = promptRowOffsets(count, 250, 12, new Map());
            const seen = new Set<number>();
            for (let top = 0; top < offsets[count]; top += 262) {
                const { start, end } = promptWindowRange(offsets, top, 600);
                for (let index = start * columns; index < Math.min(101, end * columns); index++) seen.add(index);
            }
            expect(seen.size).toBe(101);
            expect(seen.has(100)).toBe(true);
        }
    });
});

test("SSR mounts a bounded initial window and preserves list semantics and actions", () => {
    const items = Array.from({ length: 10000 }, (_, id) => ({ id: String(id), category: "来源", title: `功法 ${id}` }) as Prompt);
    let rendered = 0;
    const html = renderToStaticMarkup(
        <PromptWindowGrid
            items={items}
            scrollRef={createRef<HTMLElement>()}
            className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
            renderItem={(item) => {
                rendered++;
                return <button type="button">{item.title}</button>;
            }}
        />,
    );
    expect(rendered).toBe(4);
    expect(html).toContain('aria-setsize="10000"');
    expect(html).toContain('aria-posinset="1"');
    expect(html).toContain('role="list"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain("功法 9999");
    expect(html).toContain("height:4199980px");
});

test("SSR supports an empty or small compact grid without DOM APIs", () => {
    const render = (items: Prompt[]) =>
        renderToStaticMarkup(<PromptWindowGrid items={items} scrollRef={createRef<HTMLElement>()} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" compact active={false} renderItem={(item) => <button>{item.id}</button>} />);
    expect(render([])).toContain("height:0");
    const html = render([{ id: "only", category: "test" } as Prompt]);
    expect(html).toContain('aria-setsize="1"');
    expect(html.match(/role="listitem"/g)).toHaveLength(1);
});
