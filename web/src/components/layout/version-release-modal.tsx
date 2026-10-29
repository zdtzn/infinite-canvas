import { useState, type CSSProperties } from "react";
import { Modal, Tag } from "antd";
import { APP_VERSION } from "@/constant/env";
import { USER_RELEASE_NOTES } from "@/constant/release-notes";

function getTagColor(type: string) {
    if (type === "新增") return "green";
    if (type === "修复") return "red";
    if (type === "调整") return "blue";
    return "default";
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
    trigger?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

export function VersionReleaseModal({ className, style, trigger = true, open: controlledOpen, onOpenChange }: VersionReleaseModalProps) {
    const [innerOpen, setInnerOpen] = useState(false);
    const open = controlledOpen ?? innerOpen;
    const setOpen = (next: boolean) => {
        onOpenChange?.(next);
        setInnerOpen(next);
    };

    return (
        <>
            {trigger ? (
                <button
                    type="button"
                    className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                    style={style}
                    onClick={() => setOpen(true)}
                    title="查看版本更新"
                >
                    {APP_VERSION}
                </button>
            ) : null}
            <Modal title="版本更新" open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="mb-5 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="text-xs text-stone-500 dark:text-stone-400">当前版本</div>
                    <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{APP_VERSION}</div>
                </div>
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                    <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-100">最近更新</h3>
                    <div className="mt-2 space-y-1.5">
                        {USER_RELEASE_NOTES.map((item) => (
                            <div key={item.content} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                    {item.type}
                                </Tag>
                                <span className="min-w-0 flex-1">{item.content}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </Modal>
        </>
    );
}
