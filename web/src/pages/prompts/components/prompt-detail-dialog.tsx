import { Copy, Download, FolderPlus } from "lucide-react";
import { App, Button, Modal, Space, Tag } from "antd";
import { saveAs } from "file-saver";
import { useState } from "react";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { promptOriginalUrl, promptThumbnailUrl, PromptCover } from "@/components/prompts/prompt-cover";

async function downloadPromptCover(prompt: Prompt) {
    if (!prompt.coverUrl) return;
    const response = await fetch(promptOriginalUrl(prompt.coverUrl), { cache: "force-cache" });
    if (!response.ok) throw new Error("原图下载失败，请稍后重试");
    const blob = await response.blob();
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const fileName = (prompt.title || "prompt-image").replace(/[\\/:*?"<>|]/g, "_");
    saveAs(blob, `${fileName}.${extension}`);
}

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { message } = App.useApp();
    const [downloading, setDownloading] = useState(false);

    const handleDownload = async () => {
        if (!prompt || downloading) return;
        setDownloading(true);
        try {
            await downloadPromptCover(prompt);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "原图下载失败");
        } finally {
            setDownloading(false);
        }
    };

    return (
        <>
            <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={860}>
                {prompt ? (
                    <>
                        <div className="grid gap-5 md:grid-cols-[minmax(360px,1fr)_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <PromptCover key={prompt.id} src={promptThumbnailUrl(prompt.coverUrl)} fallbackSrc={promptOriginalUrl(prompt.coverUrl)} alt={prompt.title} loading="eager" fetchPriority="high" className="aspect-[4/3] w-full rounded-lg bg-stone-100 object-contain p-1 dark:bg-stone-900" />
                                {prompt.preview ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap gap-1.5">
                                    {prompt.tags.map((tag) => (
                                        <Tag key={tag} className="m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                                <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                                    创建：{formatPromptDate(prompt.createdAt)} · 更新：{formatPromptDate(prompt.updatedAt)}
                                </div>
                                <Space wrap className="mt-5">
                                    {prompt.coverUrl ? (
                                        <Button icon={<Download className="size-4" />} loading={downloading} onClick={() => void handleDownload()}>
                                            下载原图
                                        </Button>
                                    ) : null}
                                    <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                        复制提示词
                                    </Button>
                                    {onSaveAsset ? (
                                        <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                            加入我的资产
                                        </Button>
                                    ) : null}
                                </Space>
                            </div>
                        </div>
                    </>
                ) : null}
            </Modal>
        </>
    );
}
