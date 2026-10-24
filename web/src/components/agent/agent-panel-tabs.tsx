import type { ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";

export function AgentPanelTabs<T extends string>({
    value,
    items,
    theme,
    leading,
    right,
    onChange,
}: {
    value: T;
    items: { value: T; label: string; icon?: ReactNode; count?: number }[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    leading?: ReactNode;
    right?: ReactNode;
    onChange: (value: T) => void;
}) {
    return (
        <div className="shrink-0 border-b px-3" style={{ borderColor: theme.node.stroke }}>
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 @min-[620px]/agent:flex-nowrap">
                {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
                <nav
                    className="thin-scrollbar order-3 flex min-w-0 basis-full items-center justify-between gap-3 overflow-x-auto text-sm @min-[620px]/agent:order-none @min-[620px]/agent:flex-1 @min-[620px]/agent:basis-auto"
                    role="tablist"
                    aria-label="Agent 面板"
                >
                    {items.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={value === item.value}
                            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-1 transition ${value === item.value ? "font-medium" : "font-normal"}`}
                            style={{ borderColor: value === item.value ? theme.node.text : "transparent", color: value === item.value ? theme.node.text : theme.node.muted }}
                            onClick={() => onChange(item.value)}
                        >
                            {item.icon}
                            {item.label}
                            {item.count ? ` ${item.count}` : ""}
                        </button>
                    ))}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
            </div>
        </div>
    );
}
