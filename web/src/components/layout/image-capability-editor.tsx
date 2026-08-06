import { Button, InputNumber, Modal, Segmented, Select, Switch, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { resolveImageModelCapabilityProfile, type ChannelImageCapabilityConfig, type ImageModelCapabilities } from "@/stores/model-capabilities";
import type { ApiCallFormat } from "@/stores/use-config-store";

const resolutionOptions = [
    { label: "自动", value: "auto" },
    { label: "1K", value: "low" },
    { label: "2K", value: "medium" },
    { label: "4K", value: "high" },
];
const qualityOptions = [
    { label: "自动", value: "auto" },
    { label: "低", value: "low" },
    { label: "中", value: "medium" },
    { label: "高", value: "high" },
    { label: "标准", value: "standard" },
    { label: "高清", value: "hd" },
];
const formatOptions = [
    { label: "自动", value: "auto" },
    { label: "PNG", value: "png" },
    { label: "JPEG", value: "jpeg" },
    { label: "WebP", value: "webp" },
];
const ratioOptions = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9", "9:21", "3:1", "1:3", "4:1", "1:4", "8:1", "1:8"].map((value) => ({ label: value, value }));

export function ImageCapabilityEditor({
    open,
    modelName,
    apiFormat,
    baseUrl,
    value,
    onSave,
    onClose,
}: {
    open: boolean;
    modelName: string;
    apiFormat: ApiCallFormat;
    baseUrl: string;
    value?: ChannelImageCapabilityConfig;
    onSave: (value: ChannelImageCapabilityConfig) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<ChannelImageCapabilityConfig>(value || { mode: "auto" });

    useEffect(() => {
        if (open) setDraft(value || { mode: "auto" });
    }, [open, value]);

    const profile = useMemo(() => resolveImageModelCapabilityProfile(modelName, apiFormat, baseUrl, draft), [apiFormat, baseUrl, draft, modelName]);
    const custom = draft.mode === "custom" ? draft : toCustomCapabilities(profile.capabilities);
    const patchCustom = (patch: Partial<ChannelImageCapabilityConfig>) => setDraft({ ...custom, ...patch, mode: "custom" });

    const changeMode = (mode: ChannelImageCapabilityConfig["mode"]) => {
        if (mode === "custom") setDraft(toCustomCapabilities(profile.capabilities));
        else setDraft({ mode });
    };

    return (
        <Modal
            open={open}
            width={680}
            title={`生图能力 · ${modelName}`}
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button
                    key="save"
                    type="primary"
                    onClick={() => {
                        onSave(draft);
                        onClose();
                    }}
                >
                    应用
                </Button>,
            ]}
        >
            <div className="space-y-5">
                <div>
                    <div className="mb-2 text-sm font-medium">识别方式</div>
                    <Segmented
                        block
                        value={draft.mode}
                        onChange={(mode) => changeMode(mode as ChannelImageCapabilityConfig["mode"])}
                        options={[
                            { label: "自动识别", value: "auto" },
                            { label: "保守模式", value: "conservative" },
                            { label: "按文档自定义", value: "custom" },
                        ]}
                    />
                    <div className="mt-2 text-xs leading-5 text-stone-500">自动识别已适配的渠道；无法识别的新模型只开放方图、自动分辨率、单张输出。自定义前请以渠道官方文档为准。</div>
                </div>

                <div className="border-y border-stone-200 py-3 dark:border-stone-800">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">当前规则</span>
                        <Tag color={profile.source === "conservative" ? "orange" : profile.source === "custom" ? "blue" : "green"}>{profile.label}</Tag>
                    </div>
                    <div className="mt-2 text-xs leading-6 text-stone-500">
                        比例 {profile.capabilities.sizes.join("、")} · 输出 {profile.capabilities.resolutions.map(resolutionLabel).join("、")} · 最多 {profile.capabilities.maxOutputs} 张 · 参考图最多 {profile.capabilities.maxReferences} 张
                    </div>
                </div>

                {draft.mode === "custom" ? (
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="构图比例" className="md:col-span-2">
                            <Select mode="tags" className="w-full" value={custom.sizes} options={ratioOptions} tokenSeparators={[",", "，", " "]} placeholder="例如 1:1、16:9" onChange={(sizes) => patchCustom({ sizes })} />
                        </Field>
                        <Field label="输出分辨率">
                            <Select mode="multiple" className="w-full" value={custom.resolutions} options={resolutionOptions} onChange={(resolutions) => patchCustom({ resolutions })} />
                        </Field>
                        <Field label="生成质量">
                            <Select mode="multiple" className="w-full" value={custom.generationQualities} options={qualityOptions} onChange={(generationQualities) => patchCustom({ generationQualities })} />
                        </Field>
                        <Field label="输出格式">
                            <Select mode="multiple" className="w-full" value={custom.outputFormats} options={formatOptions} onChange={(outputFormats) => patchCustom({ outputFormats })} />
                        </Field>
                        <Field label="单次最多生成">
                            <InputNumber className="w-full" min={1} max={10} precision={0} value={custom.maxOutputs} onChange={(maxOutputs) => patchCustom({ maxOutputs: Number(maxOutputs) || 1 })} />
                        </Field>
                        <Field label="最多参考图">
                            <InputNumber className="w-full" min={0} max={16} precision={0} value={custom.maxReferences} onChange={(maxReferences) => patchCustom({ maxReferences: Number(maxReferences) || 0 })} />
                        </Field>
                        <div className="flex items-center justify-between gap-3 py-1">
                            <span className="text-sm font-medium">允许自定义像素</span>
                            <Switch checked={custom.customSize} onChange={(customSize) => patchCustom({ customSize })} />
                        </div>
                        <div className="flex items-center justify-between gap-3 py-1">
                            <span className="text-sm font-medium">允许透明背景</span>
                            <Switch checked={custom.transparentBackground} onChange={(transparentBackground) => patchCustom({ transparentBackground })} />
                        </div>
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
    return (
        <label className={className}>
            <span className="mb-1.5 block text-sm font-medium">{label}</span>
            {children}
        </label>
    );
}

function toCustomCapabilities(capabilities: ImageModelCapabilities): ChannelImageCapabilityConfig {
    return {
        mode: "custom",
        resolutions: [...capabilities.resolutions],
        generationQualities: [...capabilities.generationQualities],
        outputFormats: [...capabilities.outputFormats],
        sizes: [...capabilities.sizes],
        customSize: capabilities.customSize,
        transparentBackground: capabilities.transparentBackground,
        maxReferences: capabilities.maxReferences,
        maxOutputs: capabilities.maxOutputs,
    };
}

function resolutionLabel(value: string) {
    return ({ auto: "自动", low: "1K", medium: "2K", high: "4K" } as Record<string, string>)[value] || value;
}
