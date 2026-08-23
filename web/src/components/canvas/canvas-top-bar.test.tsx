import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, mock, test } from "bun:test";

mock.module("antd", () => ({
    Button: ({ children, icon }: { children?: ReactNode; icon?: ReactNode }) => createElement("button", null, icon, children),
    Dropdown: ({ children, menu }: { children: ReactNode; menu?: { items?: Array<{ label?: ReactNode }> } }) =>
        createElement(
            "div",
            { "data-menu-labels": menu?.items?.map((item) => (typeof item.label === "string" ? item.label : "")).filter(Boolean).join("|") },
            children,
        ),
    Modal: () => null,
    Tooltip: ({ children }: { children: ReactNode }) => children,
}));

mock.module("@/components/layout/user-status-actions", () => ({ UserStatusActions: () => null }));
mock.module("@/constant/env", () => ({ DOCS_URL: "https://example.com/docs" }));
mock.module("@/features/cultivation/status-pill", () => ({ CultivationStatusPill: () => null }));
mock.module("@/stores/use-canvas-side-panel-store", () => ({
    useCanvasSidePanelStore: (selector: (state: { panelOpen: boolean; togglePanel: () => void }) => unknown) => selector({ panelOpen: false, togglePanel: () => undefined }),
}));
mock.module("@/stores/use-theme-store", () => ({
    useThemeStore: (selector: (state: { theme: "dark" }) => unknown) => selector({ theme: "dark" }),
}));

test("canvas header exposes direct home and canvas-list navigation", async () => {
    const { CanvasTopBar } = await import("./canvas-top-bar");
    const noop = () => undefined;
    const html = renderToStaticMarkup(
        <CanvasTopBar
            title="测试画布"
            titleDraft="测试画布"
            isTitleEditing={false}
            onTitleDraftChange={noop}
            onStartTitleEditing={noop}
            onFinishTitleEditing={noop}
            onCancelTitleEditing={noop}
            canUndo={false}
            canRedo={false}
            onHome={noop}
            onProjects={noop}
            onCreateProject={noop}
            onCreateBranch={noop}
            onDeleteProject={noop}
            onExportProject={noop}
            onImportImage={noop}
            onUndo={noop}
            onRedo={noop}
            agentOpen={false}
            compactAgentStatus={{ connected: false, enabled: false, activity: "" }}
            onToggleAgent={noop}
        />,
    );

    expect(html).toContain('aria-label="返回洞天列表"');
    expect(html).toContain(">洞天</span>");
    expect(html).toContain('aria-label="返回首页"');
    expect(html).toContain('data-menu-labels="文档|新建画布|从当前画布创建分支|删除当前画布|导入素材|导出当前画布|保存当前快照"');
    expect(html).not.toContain('data-menu-labels="返回首页');
});
