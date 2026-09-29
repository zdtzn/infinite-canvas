import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { Prompt } from "@/services/api/prompts";
import { promptGridScrollTop, promptRowOffsets, promptWindowRange, promptWindowRows } from "./prompt-window-range";

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]';
function tabControls(card: HTMLElement) {
    return Array.from(card.querySelectorAll<HTMLElement>(focusable)).filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden" && !control.closest("[inert]"));
}
function revealControl(control: HTMLElement, scroller: HTMLElement) {
    const rect = control.getBoundingClientRect();
    const top = scroller.getBoundingClientRect().top + scroller.clientTop;
    if (rect.top < top) scroller.scrollTop += rect.top - top;
    else if (rect.bottom > top + scroller.clientHeight) scroller.scrollTop += rect.bottom - top - scroller.clientHeight;
}

export function PromptWindowGrid({
    items,
    scrollRef,
    className,
    renderItem,
    compact = false,
    active = true,
}: {
    items: Prompt[];
    scrollRef: RefObject<HTMLElement | null>;
    className: string;
    renderItem: (item: Prompt) => ReactNode;
    compact?: boolean;
    active?: boolean;
}) {
    const gridRef = useRef<HTMLDivElement>(null);
    const previousItems = useRef(items);
    const heights = useRef(new Map<number, number>());
    const [layout, setLayout] = useState({ columns: 1, width: 0, gap: 20, top: 0, viewport: 600, revision: 0 });
    const layoutRef = useRef(layout);
    const restoreFocus = useRef<{ item: number; control: number } | null>(null);
    const [focusedItem, setFocusedItem] = useState<number | null>(null);
    const count = Math.ceil(items.length / layout.columns);
    const estimate = layout.width ? ((layout.width - (layout.columns - 1) * layout.gap) / layout.columns) * 0.75 + (compact ? 170 : 210) : 400;
    const offsets = useMemo(() => promptRowOffsets(count, estimate, layout.gap, heights.current), [count, estimate, layout.gap, layout.revision]);
    const offsetsRef = useRef(offsets);
    offsetsRef.current = offsets;
    const range = promptWindowRange(offsets, layout.top, layout.viewport);
    const rows = promptWindowRows(range.start, range.end, focusedItem === null ? null : Math.floor(focusedItem / layout.columns), count);

    useLayoutEffect(() => {
        const saved = restoreFocus.current;
        restoreFocus.current = null;
        if (!saved || !active || (document.activeElement !== document.body && !gridRef.current?.contains(document.activeElement))) return;
        const card = gridRef.current?.querySelector<HTMLElement>(`[data-prompt-item="${saved.item}"]`);
        const control = card && tabControls(card)[saved.control];
        if (control) {
            control.focus({ preventScroll: true });
            if (scrollRef.current) revealControl(control, scrollRef.current);
        }
    }, [layout.columns, active, scrollRef]);

    // The parent's scroll ref is attached after child layout effects on first mount.
    useEffect(() => {
        const grid = gridRef.current;
        const scroller = scrollRef.current;
        if (!grid || !scroller || !active) return;
        // Appending pages preserves measurements; replacement/reordering invalidates them.
        if (!previousItems.current.every((item, index) => items[index] === item)) {
            heights.current.clear();
            setFocusedItem(null);
        }
        previousItems.current = items;
        let frame = 0;
        const measure = () => {
            frame = 0;
            if (!grid.clientWidth || !scroller.clientHeight) return;
            const old = layoutRef.current;
            const style = getComputedStyle(grid);
            const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
            const width = grid.clientWidth;
            const gap = parseFloat(style.rowGap) || 0;
            const top = promptGridScrollTop(scroller.scrollTop, scroller.getBoundingClientRect().top, scroller.clientTop, grid.getBoundingClientRect().top);
            const resized = columns !== old.columns || width !== old.width || gap !== old.gap;
            if (columns !== old.columns && grid.contains(document.activeElement)) {
                const focused = document.activeElement as HTMLElement;
                const card = focused.closest<HTMLElement>("[data-prompt-item]");
                if (card) restoreFocus.current = { item: Number(card.dataset.promptItem), control: tabControls(card).indexOf(focused) };
            }
            if (resized) heights.current.clear();
            let correction = 0;
            let changed = resized;
            grid.querySelectorAll<HTMLElement>("[data-prompt-row]").forEach((row) => {
                // Wait for the new column layout before measuring its rows.
                if (columns !== old.columns) return;
                const index = Number(row.dataset.promptRow);
                const height = row.getBoundingClientRect().height;
                if (!height || heights.current.get(index) === height) return;
                const before = offsetsRef.current;
                if (!resized && before[index + 1] <= top) correction += height - (before[index + 1] - before[index] - gap);
                heights.current.set(index, height);
                changed = true;
            });
            if (correction) scroller.scrollTop += correction;
            const next = { columns, width, gap, top: top + correction, viewport: scroller.clientHeight, revision: old.revision + (changed ? 1 : 0) };
            layoutRef.current = next;
            setLayout((current) => (Object.keys(next).every((key) => next[key as keyof typeof next] === current[key as keyof typeof next]) ? current : next));
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(schedule);
        const observeRows = () => {
            observer.disconnect();
            for (let element: HTMLElement | null = grid; element; element = element.parentElement) {
                observer.observe(element);
                if (element === scroller) break;
                // Headers/filters can move the grid without resizing its ancestors.
                for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) observer.observe(sibling);
            }
            grid.querySelectorAll<HTMLElement>("[data-prompt-row]").forEach((row) => observer.observe(row));
            schedule();
        };
        const mutations = new MutationObserver(observeRows);
        mutations.observe(grid, { childList: true });
        scroller.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        measure();
        observeRows();
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            mutations.disconnect();
            scroller.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
        };
    }, [active, items, scrollRef]);

    const handleTab = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target as HTMLElement;
        const card = target.closest<HTMLElement>("[data-prompt-item]");
        if (!card) return;
        const controls = tabControls(card);
        if (target !== controls[event.shiftKey ? 0 : controls.length - 1]) return;
        const next = Number(card.dataset.promptItem) + (event.shiftKey ? -1 : 1);
        if (next < 0 || next >= items.length) return;
        event.preventDefault();
        flushSync(() => setFocusedItem(next));
        const nextCard = gridRef.current?.querySelector<HTMLElement>(`[data-prompt-item="${next}"]`);
        const nextControls = nextCard && tabControls(nextCard);
        const control = nextControls?.[event.shiftKey ? nextControls.length - 1 : 0];
        control?.focus({ preventScroll: true });
        const scroller = scrollRef.current;
        if (control && scroller) revealControl(control, scroller);
    };

    return (
        <div
            ref={gridRef}
            className={`relative ${className}`}
            role="list"
            aria-label="功法列表"
            style={{ height: Math.max(0, offsets[count] - layout.gap), overflowAnchor: "none" }}
            onKeyDown={handleTab}
            onFocusCapture={(event) => {
                const card = (event.target as HTMLElement).closest<HTMLElement>("[data-prompt-item]");
                if (card) setFocusedItem(Number(card.dataset.promptItem));
            }}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocusedItem(null);
            }}
        >
            {rows.map((row) => (
                <div key={row} data-prompt-row={row} className="absolute left-0 top-0 grid w-full" style={{ transform: `translateY(${offsets[row]}px)`, gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gap: layout.gap }}>
                    {items.slice(row * layout.columns, (row + 1) * layout.columns).map((item, column) => {
                        const index = row * layout.columns + column;
                        return (
                            <div key={`${item.sourceId ?? item.category}:${item.id}`} data-prompt-item={index} role="listitem" aria-posinset={index + 1} aria-setsize={items.length} className="grid min-w-0">
                                {renderItem(item)}
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
