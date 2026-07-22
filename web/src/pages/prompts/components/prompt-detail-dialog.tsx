import { Copy, Download, FolderPlus } from "lucide-react";
import { App, Button, Modal, Space, Tag } from "antd";
import { saveAs } from "file-saver";
import { useEffect, useRef, useState } from "react";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { promptImageCandidates, promptOriginalCandidates, PromptCover } from "@/components/prompts/prompt-cover";

const DOWNLOAD_TIMEOUT_MS = 8_000;

async function fetchPromptImage(url: string, signal: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = window.setTimeout(abort, DOWNLOAD_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    try {
        const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
        if (!response.ok) {
            await response.body?.cancel();
            return null;
        }
        const blob = await response.blob();
        return blob.size ? blob : null;
    } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
    }
}

async function downloadPromptCover(prompt: Prompt, signal: AbortSignal) {
    if (!prompt.coverUrl) return;
    for (const url of promptOriginalCandidates(prompt.coverUrl)) {
        if (signal.aborted) throw new DOMException("下载已取消", "AbortError");
        try {
            const blob = await fetchPromptImage(url, signal);
            if (!blob) continue;
            const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
            const fileName = (prompt.title || "prompt-image").replace(/[\\/:*?"<>|]/g, "_");
            saveAs(blob, `${fileName}.${extension}`);
            return;
        } catch {
            if (signal.aborted) throw new DOMException("下载已取消", "AbortError");
            // Try the next original-image route.
        }
    }
    throw new Error("原图下载失败，请稍后重试");
}

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { message } = App.useApp();
    const [downloading, setDownloading] = useState(false);
    const downloadAbortRef = useRef<AbortController | null>(null);
    const downloadSequenceRef = useRef(0);

    useEffect(() => {
        downloadAbortRef.current?.abort();
        downloadAbortRef.current = null;
        setDownloading(false);
        return () => downloadAbortRef.current?.abort();
    }, [prompt?.id]);

    const handleDownload = async () => {
        if (!prompt || downloading) return;
        const controller = new AbortController();
        const sequence = downloadSequenceRef.current + 1;
        downloadSequenceRef.current = sequence;
        downloadAbortRef.current?.abort();
        downloadAbortRef.current = controller;
        setDownloading(true);
        try {
            await downloadPromptCover(prompt, controller.signal);
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "原图下载失败");
        } finally {
            if (downloadSequenceRef.current === sequence) {
                downloadAbortRef.current = null;
                setDownloading(false);
            }
        }
    };

    const handleClose = () => {
        downloadAbortRef.current?.abort();
        downloadAbortRef.current = null;
        setDownloading(false);
        onClose();
    };

    return (
        <>
            <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={handleClose} footer={null} width={860}>
                {prompt ? (
                    <>
                        <div className="grid gap-5 md:grid-cols-[minmax(360px,1fr)_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <PromptCover key={prompt.id} sources={promptImageCandidates(prompt.coverUrl)} alt={prompt.title} loading="eager" fetchPriority="high" className="aspect-[4/3] w-full rounded-lg bg-stone-100 object-contain p-1 dark:bg-stone-900" />
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
