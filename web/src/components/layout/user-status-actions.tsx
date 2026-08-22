import type { CSSProperties } from "react";
import { BookOpen, CircleUserRound, Crown, Keyboard, LogOut, Moon, MoreHorizontal, Puzzle, ShieldCheck, Sun } from "lucide-react";
import { App, Dropdown, Input, Modal, type MenuProps } from "antd";
import { useState } from "react";

import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL, REPOSITORY_URL } from "@/constant/env";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { TaskCenter } from "@/components/layout/task-center";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { changePersonalPassword, logoutAccess, revokeAllServerSessions } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { useImperialMode } from "@/features/cultivation/imperial-mode";
import { cn } from "@/lib/utils";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";

type UserStatusActionsProps = {
    showTaskCenter?: boolean;
    showWorkspaceMenu?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white [&_svg]:size-4";

export function WorkspaceMenuAction({ variant = "default", onOpenShortcuts, onOpenPlugins }: Omit<UserStatusActionsProps, "showTaskCenter" | "showWorkspaceMenu">) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
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

export function UserStatusActions({ showTaskCenter = true, showWorkspaceMenu = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { modal, message } = App.useApp();
    const [passwordOpen, setPasswordOpen] = useState(false);
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
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
                  key: "revoke-sessions",
                  icon: <ShieldCheck className="size-4" />,
                  label: "退出其他设备",
                  onClick: () => {
                      modal.confirm({
                          title: "退出其他设备？",
                          content: "其他电脑、手机和浏览器中的登录状态会立即失效，当前设备会保持登录。",
                          okText: "确认退出",
                          cancelText: "取消",
                          onOk: async () => {
                              await revokeAllServerSessions();
                              message.success("已退出其他设备");
                          },
                      });
                  },
              },
              {
                  key: "change-password",
                  icon: <ShieldCheck className="size-4" />,
                  label: "修改个人密码",
                  onClick: () => setPasswordOpen(true),
              },
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
        <>
        <div className="inline-flex shrink-0 items-center gap-1">
            {showTaskCenter ? <TaskCenter /> : null}
            {showWorkspaceMenu ? <WorkspaceMenuAction variant={variant} onOpenShortcuts={onOpenShortcuts} onOpenPlugins={onOpenPlugins} /> : null}
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
        <Modal
            title="修改个人密码"
            open={passwordOpen}
            okText="保存密码"
            cancelText="取消"
            confirmLoading={passwordSaving}
            onCancel={() => {
                if (!passwordSaving) setPasswordOpen(false);
            }}
            onOk={async () => {
                if (newPassword.length < 6) {
                    message.error("新密码至少 6 位");
                    return;
                }
                if (newPassword !== confirmPassword) {
                    message.error("两次输入的新密码不一致");
                    return;
                }
                setPasswordSaving(true);
                try {
                    await changePersonalPassword(currentPassword, newPassword);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                    setPasswordOpen(false);
                    message.success("个人密码已更新，其他设备已退出");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "密码更新失败");
                } finally {
                    setPasswordSaving(false);
                }
            }}
        >
            <div className="space-y-3">
                <Input.Password value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前密码" autoComplete="current-password" />
                <Input.Password value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="新密码（至少 6 位）" autoComplete="new-password" />
                <Input.Password value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" autoComplete="new-password" />
            </div>
        </Modal>
        </>
    );
}
