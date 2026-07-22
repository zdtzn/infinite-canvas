import type { CSSProperties } from "react";
import { BookOpen, Keyboard, LogOut, MoreHorizontal, Puzzle, Settings2 } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";

import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL } from "@/constant/env";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { TaskCenter } from "@/components/layout/task-center";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { logoutAccess } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    showTaskCenter?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, showTaskCenter = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const clearSession = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const menuItems: MenuProps["items"] = [
        onOpenPlugins
            ? {
                  key: "plugins",
                  icon: <Puzzle className="size-4" />,
                  label: "节点插件",
                  onClick: onOpenPlugins,
              }
            : null,
        {
            key: "docs",
            icon: <BookOpen className="size-4" />,
            label: "文档",
            onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer"),
        },
        showConfig
            ? {
                  key: "config",
                  icon: <Settings2 className="size-4" />,
                  label: "工作台设置",
                  onClick: () => openConfigDialog(false),
              }
            : null,
        {
            key: "theme",
            label: theme === "dark" ? "切换至浅色主题" : "切换至深色主题",
            onClick: () => setTheme(theme === "dark" ? "light" : "dark"),
        },
        {
            key: "github",
            label: "GitHub",
            onClick: () => window.open("https://github.com/basketikun/infinite-canvas", "_blank", "noopener,noreferrer"),
        },
        PUBLIC_MODE
            ? {
                  key: "logout",
                  icon: <LogOut className="size-4" />,
                  danger: true,
                  label: "退出登录",
                  onClick: () => void logoutAccess().finally(clearSession),
              }
            : null,
        onOpenShortcuts
            ? {
                  key: "shortcuts",
                  icon: <Keyboard className="size-4" />,
                  label: "快捷键",
                  onClick: onOpenShortcuts,
              }
            : null,
    ].filter(Boolean) as MenuProps["items"];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showTaskCenter ? <TaskCenter /> : null}
            <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
                <button type="button" className={naturalIconClass} style={iconStyle} aria-label="打开应用菜单" title="应用菜单">
                    <MoreHorizontal className="size-4" />
                </button>
            </Dropdown>
            <VersionReleaseModal style={versionStyle} />
        </div>
    );
}
