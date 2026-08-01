import type { CSSProperties } from "react";
import { BookOpen, CircleUserRound, Crown, Keyboard, LogOut, Moon, MoreHorizontal, Puzzle, Settings2, Sun } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";

import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL, REPOSITORY_URL } from "@/constant/env";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { TaskCenter } from "@/components/layout/task-center";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { logoutAccess } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { useImperialMode } from "@/features/cultivation/imperial-mode";
import { cn } from "@/lib/utils";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";

type UserStatusActionsProps = {
    showConfig?: boolean;
    showTaskCenter?: boolean;
    showWorkspaceMenu?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white [&_svg]:size-4";

export function WorkspaceMenuAction({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: Omit<UserStatusActionsProps, "showTaskCenter" | "showWorkspaceMenu">) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
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
            icon: theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />,
            label: theme === "dark" ? "切换至浅色主题" : "切换至深色主题",
            onClick: () => setTheme(theme === "dark" ? "light" : "dark"),
        },
        {
            key: "github",
            label: "GitHub",
            onClick: () => window.open(REPOSITORY_URL, "_blank", "noopener,noreferrer"),
        },
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
        <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
            <button type="button" className={naturalIconClass} style={iconStyle} aria-label="打开工作台菜单" title="工作台菜单">
                <MoreHorizontal className="size-4" />
            </button>
        </Dropdown>
    );
}

export function UserStatusActions({ showConfig = true, showTaskCenter = true, showWorkspaceMenu = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const user = useUserStore((state) => state.user);
    const clearSession = useUserStore((state) => state.clearSession);
    const { isDouEmperor, isImperialMode } = useImperialMode();
    const canvasTheme = canvasThemes[theme];
    const versionStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const accountMenuItems: MenuProps["items"] = PUBLIC_MODE
        ? [
              {
                  key: "account",
                  label: user?.displayName || user?.username || "当前账号",
                  disabled: true,
              },
              { type: "divider" },
              {
                  key: "logout",
                  icon: <LogOut className="size-4" />,
                  danger: true,
                  label: "退出登录",
                  onClick: () => void logoutAccess().finally(clearSession),
              },
          ]
        : [];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showTaskCenter ? <TaskCenter /> : null}
            {showWorkspaceMenu ? <WorkspaceMenuAction showConfig={showConfig} variant={variant} onOpenShortcuts={onOpenShortcuts} onOpenPlugins={onOpenPlugins} /> : null}
            {PUBLIC_MODE ? (
                <Dropdown menu={{ items: accountMenuItems }} trigger={["click"]}>
                    <button
                        type="button"
                        className={cn(naturalIconClass, isDouEmperor && "imperial-avatar-menu-trigger", isImperialMode && "is-active")}
                        style={versionStyle}
                        aria-label="打开账户菜单"
                        title={user?.displayName || user?.username || "当前账号"}
                    >
                        {user?.avatarUrl ? (
                            <ProfileAvatarImage
                                src={user.avatarUrl}
                                alt=""
                                fallback={isDouEmperor ? <Crown className="size-4" /> : <CircleUserRound className="size-4" />}
                                width={24}
                                height={24}
                                loading="eager"
                                fetchPriority="high"
                                className="size-6 rounded-full"
                            />
                        ) : isDouEmperor ? (
                            <Crown className="size-4" />
                        ) : (
                            <CircleUserRound className="size-4" />
                        )}
                    </button>
                </Dropdown>
            ) : null}
            <VersionReleaseModal style={versionStyle} />
        </div>
    );
}
