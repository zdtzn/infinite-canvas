import { App, Select, Spin } from "antd";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
    fetchPromptOptimizerAdminConfiguration,
    updatePromptOptimizerAdminConfiguration,
    type PromptOptimizerAdminConfiguration,
    type PromptOptimizerTarget,
} from "@/services/server-api";
import {
    decodeChannelModel,
    encodeChannelModel,
    modelOptionLabel,
    selectableModelsByCapability,
    type AiConfig,
} from "@/stores/use-config-store";

const AUTO_TARGET = "__automatic_prompt_optimizer__";

export function promptOptimizerSelectionValue(target: PromptOptimizerTarget | null) {
    return target ? encodeChannelModel(target.channelId, target.model) : AUTO_TARGET;
}

export function promptOptimizerTargetFromSelection(value: string): PromptOptimizerTarget | null | undefined {
    if (value === AUTO_TARGET) return null;
    return decodeChannelModel(value) || undefined;
}

export function PromptOptimizerAdminSetting({ config }: { config: AiConfig }) {
    const { message } = App.useApp();
    const [configuration, setConfiguration] = useState<PromptOptimizerAdminConfiguration | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const textModelSignature = textModels.join("\u0000");

    useEffect(() => {
        let active = true;
        setLoading(true);
        void fetchPromptOptimizerAdminConfiguration()
            .then((result) => {
                if (active) setConfiguration(result);
            })
            .catch((error) => {
                if (active) message.error(error instanceof Error ? error.message : "提示词优化模型读取失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [message, textModelSignature]);

    const selectedTarget = configuration?.lockedByEnvironment ? configuration.effective : configuration?.configured;
    const selectedValue = promptOptimizerSelectionValue(selectedTarget || null);
    const options = [
        { value: AUTO_TARGET, label: "自动选择（按渠道顺序）" },
        ...textModels.map((value) => ({ value, label: modelOptionLabel(config, value) })),
    ];
    const effectiveLabel = configuration?.effective ? modelOptionLabel(config, encodeChannelModel(configuration.effective.channelId, configuration.effective.model)) : "尚无可用文本模型";

    const updateTarget = async (value: string) => {
        if (saving || configuration?.lockedByEnvironment) return;
        const target = promptOptimizerTargetFromSelection(value);
        if (target === undefined) {
            message.error("提示词优化模型无效");
            return;
        }
        setSaving(true);
        try {
            const result = await updatePromptOptimizerAdminConfiguration(target);
            setConfiguration(result);
            message.success(target ? "提示词优化模型已保存" : "已恢复自动选择文本模型");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提示词优化模型保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="mb-4 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Sparkles className="size-4" />
                        提示词优化模型
                    </div>
                    <div className="mt-1 text-xs text-stone-500">仅管理员配置。普通用户不会看到或选择该模型，提示词优化也不消耗修炼额度。</div>
                </div>
                <div className="w-full shrink-0 md:w-[320px]">
                    <Select
                        className="w-full"
                        value={selectedValue}
                        options={options}
                        loading={loading || saving}
                        disabled={loading || saving || Boolean(configuration?.lockedByEnvironment)}
                        onChange={(value) => void updateTarget(value)}
                    />
                </div>
            </div>
            <div className="mt-2 flex min-h-5 items-center gap-2 text-xs text-stone-500">
                {loading ? <Spin size="small" /> : null}
                {!loading ? `当前实际使用：${effectiveLabel}` : "正在读取服务端配置"}
                {configuration?.lockedByEnvironment ? " · 已由服务器环境变量锁定" : ""}
            </div>
        </section>
    );
}
