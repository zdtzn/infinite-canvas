import { Check, Copy, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Alert, App, Button, Input, Modal, Spin, Tooltip } from "antd";

import { PUBLIC_MODE } from "@/constant/runtime-config";
import { useCopyText } from "@/hooks/use-copy-text";
import { optimizeImagePrompt, type ImagePromptOptimizationContext } from "@/services/api/prompt-optimizer";

type ImagePromptOptimizerProps = {
    prompt: string;
    context: ImagePromptOptimizationContext;
    onAdopt: (prompt: string) => void;
    compact?: boolean;
    disabled?: boolean;
    className?: string;
    style?: CSSProperties;
};

export function ImagePromptOptimizer({ prompt, context, onAdopt, compact = false, disabled = false, className, style }: ImagePromptOptimizerProps) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [original, setOriginal] = useState("");
    const [optimized, setOptimized] = useState("");
    const [error, setError] = useState("");
    const requestSequence = useRef(0);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(
        () => () => {
            requestSequence.current += 1;
            controllerRef.current?.abort();
        },
        [],
    );

    const runOptimization = async (sourcePrompt: string) => {
        const value = sourcePrompt.trim();
        if (!value || controllerRef.current) return;
        if (!PUBLIC_MODE) {
            message.warning("提示词优化需在 Bun 完整模式下使用");
            return;
        }

        const sequence = requestSequence.current + 1;
        requestSequence.current = sequence;
        const controller = new AbortController();
        controllerRef.current = controller;
        setOriginal(value);
        setOptimized("");
        setError("");
        setOpen(true);
        setLoading(true);

        try {
            const result = await optimizeImagePrompt(value, context, controller.signal);
            if (requestSequence.current === sequence) setOptimized(result.optimized);
        } catch (requestError) {
            if (controller.signal.aborted || requestSequence.current !== sequence) return;
            setError(requestError instanceof Error ? requestError.message : "提示词优化暂不可用");
        } finally {
            if (requestSequence.current === sequence) {
                controllerRef.current = null;
                setLoading(false);
            }
        }
    };

    const close = () => {
        requestSequence.current += 1;
        controllerRef.current?.abort();
        controllerRef.current = null;
        setLoading(false);
        setOpen(false);
    };

    const adopt = () => {
        const value = optimized.trim();
        if (!value) return;
        onAdopt(value);
        message.success("已采用优化提示词");
        close();
    };

    const trigger = (
        <Button
            type={compact ? "text" : "default"}
            size={compact ? "middle" : "small"}
            icon={<Sparkles className="size-3.5" />}
            disabled={disabled || !prompt.trim() || !PUBLIC_MODE}
            loading={loading && !open}
            className={className}
            style={style}
            aria-label="优化提示词"
            onClick={() => void runOptimization(prompt)}
        >
            {compact ? null : "优化提示词"}
        </Button>
    );

    return (
        <>
            <Tooltip title={PUBLIC_MODE ? "免费优化提示词，原提示词不会自动替换" : "需在 Bun 完整模式下使用"}>
                <span className={compact ? "inline-flex shrink-0" : "inline-flex"}>{trigger}</span>
            </Tooltip>
            <Modal title="优化提示词" open={open} onCancel={close} footer={null} width={920} centered destroyOnHidden>
                <div className="grid gap-4 md:grid-cols-2">
                    <PromptTextPanel title="原提示词" value={original} readOnly onCopy={() => copyText(original, "已复制原提示词")} />
                    <PromptTextPanel title="优化稿" value={optimized} loading={loading} onChange={setOptimized} onCopy={() => copyText(optimized, "已复制优化提示词")} />
                </div>

                {error ? <Alert className="mt-4" type="warning" showIcon message={error} description="原提示词保持不变，可直接继续生成或重新优化。" /> : null}

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <Button onClick={close}>取消</Button>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} disabled={!original || loading} onClick={() => void runOptimization(original)}>
                        重新优化
                    </Button>
                    <Button type="primary" icon={<Check className="size-4" />} disabled={!optimized.trim() || loading} onClick={adopt}>
                        采用优化稿
                    </Button>
                </div>
            </Modal>
        </>
    );
}

function PromptTextPanel({ title, value, readOnly = false, loading = false, onChange, onCopy }: { title: string; value: string; readOnly?: boolean; loading?: boolean; onChange?: (value: string) => void; onCopy: () => void }) {
    return (
        <section className="min-w-0">
            <div className="mb-2 flex h-8 items-center justify-between gap-3">
                <div className="min-w-0 truncate text-sm font-semibold">
                    {title}
                    <span className="ml-2 text-xs font-normal text-stone-400">{value.length.toLocaleString()} 字</span>
                </div>
                <Tooltip title="复制">
                    <Button type="text" size="small" icon={<Copy className="size-3.5" />} disabled={!value} aria-label={`复制${title}`} onClick={onCopy} />
                </Tooltip>
            </div>
            <div className="relative">
                <Input.TextArea value={value} readOnly={readOnly || loading} autoSize={{ minRows: 7, maxRows: 14 }} placeholder={loading ? "正在整理画面语言……" : "暂无优化结果"} onChange={(event) => onChange?.(event.target.value)} />
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70 backdrop-blur-[1px]">
                        <Spin size="small" />
                    </div>
                ) : null}
            </div>
        </section>
    );
}
