import { useEffect, useId, useRef, useState } from "react";
import { Button, Checkbox, InputNumber, Modal, Segmented, Slider } from "antd";
import { RotateCcw, WandSparkles } from "lucide-react";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
    target: "scene" | "subject";
    preserveText: boolean;
    preserveBackground: boolean;
};
const defaultParams: CanvasImageAngleParams = {
    horizontalAngle: 0,
    pitchAngle: 0,
    cameraDistance: 5,
    wideAngle: false,
    target: "scene",
    preserveText: true,
    preserveBackground: false,
};
const presets = [
    { label: "正面", horizontalAngle: 0, pitchAngle: 0 },
    { label: "左前方", horizontalAngle: -45, pitchAngle: 0 },
    { label: "右前方", horizontalAngle: 45, pitchAngle: 0 },
    { label: "俯拍", horizontalAngle: 0, pitchAngle: 45 },
];

export function CanvasNodeAngleDialog({ dataUrl, open, modelLabel, onClose, onConfirm }: { dataUrl: string; open: boolean; modelLabel: string; onClose: () => void; onConfirm: (params: CanvasImageAngleParams) => void | Promise<void> }) {
    const [params, setParams] = useState(defaultParams);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    useEffect(() => {
        if (open) setParams(defaultParams);
    }, [dataUrl, open]);
    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => setParams((current) => ({ ...current, [key]: value }));
    const horizontal = params.horizontalAngle === 0 ? "正面" : `${params.horizontalAngle > 0 ? "右" : "左"}侧 ${Math.abs(params.horizontalAngle)}°`;
    const pitch = params.pitchAngle === 0 ? "平视" : `${params.pitchAngle > 0 ? "俯拍" : "仰拍"} ${Math.abs(params.pitchAngle)}°`;
    const radians = (params.horizontalAngle * Math.PI) / 180;
    const cameraX = 100 + Math.sin(radians) * 65;
    const cameraY = 65 + Math.cos(radians) * 38;
    const submit = async () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            await onConfirm(params);
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };
    return (
        <Modal title="AI 多角度" open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={900} centered destroyOnHidden styles={{ body: { maxHeight: "75dvh", overflowY: "auto", overscrollBehavior: "contain" } }}>
            <p className="mb-5 text-sm opacity-75">基于原图生成新视角，原图不变。相机方向仅作示意，不是生成效果预览。</p>
            <div className="grid gap-6 md:grid-cols-2">
                <div className="min-w-0 space-y-3">
                    <div className="rounded-xl border p-4">
                        <p className="mb-3 text-sm opacity-75">原图 · 完整显示</p>
                        <img src={dataUrl} alt="用于生成新视角的完整原图" className="h-64 w-full object-contain" draggable={false} />
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-3">
                        <svg viewBox="0 0 200 130" className="h-24 w-32 shrink-0" role="img" aria-label={`相机方位示意：${horizontal}，${pitch}`}>
                            <ellipse cx="100" cy="65" rx="65" ry="38" fill="none" stroke="currentColor" opacity="0.25" strokeDasharray="4 4" />
                            <circle cx="100" cy="65" r="13" fill="currentColor" opacity="0.2" />
                            <text x="100" y="42" textAnchor="middle" fill="currentColor" fontSize="12">
                                主体
                            </text>
                            <line x1="100" y1="65" x2={cameraX} y2={cameraY} stroke="currentColor" opacity="0.5" />
                            <rect x={cameraX - 7} y={cameraY - 5} width="14" height="10" rx="2" fill="currentColor" />
                            <text x="100" y="126" textAnchor="middle" fill="currentColor" fontSize="11">
                                正面基准 · 俯视示意图
                            </text>
                        </svg>
                        <div className="min-w-0 text-sm">
                            <p className="font-medium">
                                {horizontal} · {pitch}
                            </p>
                            <p className="mt-1 opacity-75">相机绕主体移动</p>
                        </div>
                    </div>
                    <p className="text-xs leading-relaxed opacity-75">隐藏面由 AI 推测，不能保证真实还原；文字与 Logo 也需检查生成结果。</p>
                </div>
                <div className="min-w-0 space-y-5">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="常用角度">
                        {presets.map((preset) => (
                            <Button
                                key={preset.label}
                                aria-pressed={params.horizontalAngle === preset.horizontalAngle && params.pitchAngle === preset.pitchAngle}
                                type={params.horizontalAngle === preset.horizontalAngle && params.pitchAngle === preset.pitchAngle ? "primary" : "default"}
                                onClick={() => setParams((current) => ({ ...current, horizontalAngle: preset.horizontalAngle, pitchAngle: preset.pitchAngle }))}
                            >
                                {preset.label}
                            </Button>
                        ))}
                    </div>
                    <AngleSlider label="左右方位" value={params.horizontalAngle} min={-60} max={60} description={horizontal} marks={{ [-60]: "左侧", 0: "正面", 60: "右侧" }} onChange={(value) => update("horizontalAngle", value)} />
                    <AngleSlider label="俯仰角度" value={params.pitchAngle} min={-45} max={45} description={pitch} marks={{ [-45]: "仰拍", 0: "平视", 45: "俯拍" }} onChange={(value) => update("pitchAngle", value)} />
                    <div>
                        <p className="mb-2 font-medium" id="angle-framing">
                            取景范围
                        </p>
                        <Segmented
                            aria-labelledby="angle-framing"
                            block
                            value={params.cameraDistance}
                            options={[
                                { label: "近景", value: 1 },
                                { label: "中景", value: 5 },
                                { label: "远景", value: 10 },
                            ]}
                            onChange={(value) => update("cameraDistance", value)}
                        />
                    </div>
                    <div>
                        <p className="mb-2 font-medium" id="angle-lens">
                            镜头
                        </p>
                        <Segmented
                            aria-labelledby="angle-lens"
                            block
                            value={params.wideAngle ? "wide" : "standard"}
                            options={[
                                { label: "标准", value: "standard" },
                                { label: "广角", value: "wide" },
                            ]}
                            onChange={(value) => update("wideAngle", value === "wide")}
                        />
                    </div>
                    <div>
                        <p className="mb-2 font-medium" id="angle-target">
                            调整对象
                        </p>
                        <Segmented
                            aria-labelledby="angle-target"
                            block
                            value={params.target}
                            options={[
                                { label: "整体场景", value: "scene" },
                                { label: "仅主体 / 商品", value: "subject" },
                            ]}
                            onChange={(value) => update("target", value as CanvasImageAngleParams["target"])}
                        />
                        <p className="mt-2 text-xs opacity-75">{params.target === "subject" ? "改变主体朝向，尽量保留海报其他元素；多个主体将一同调整。" : "移动相机观察整个场景，构图随视角自然变化。"}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Checkbox checked={params.preserveText} onChange={(event) => update("preserveText", event.target.checked)}>
                            尽量保留文字与 Logo
                        </Checkbox>
                        <Checkbox checked={params.preserveBackground} onChange={(event) => update("preserveBackground", event.target.checked)}>
                            保留背景内容与风格
                        </Checkbox>
                    </div>
                </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <Button icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => setParams(defaultParams)}>
                    重置
                </Button>
                <div className="min-w-0 text-sm opacity-75 break-all">模型：{modelLabel || "未选择"} · 生成 1 张</div>
                <Button type="primary" size="large" loading={submitting} icon={<WandSparkles className="size-4" aria-hidden="true" />} onClick={() => void submit()}>
                    生成新视角
                </Button>
            </div>
        </Modal>
    );
}

function AngleSlider({ label, value, min, max, description, marks, onChange }: { label: string; value: number; min: number; max: number; description: string; marks: Record<number, string>; onChange: (value: number) => void }) {
    const id = useId();
    return (
        <div className="pb-2">
            <div className="mb-1 flex items-center justify-between gap-3">
                <label htmlFor={id} className="font-medium">
                    {label}
                </label>
                <InputNumber
                    id={id}
                    aria-label={`${label}数值（度）`}
                    min={min}
                    max={max}
                    step={1}
                    precision={0}
                    value={value}
                    suffix="°"
                    onChange={(next) => {
                        if (next !== null && Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
                    }}
                />
            </div>
            <div className="px-3">
                <Slider ariaLabelForHandle={label} ariaValueTextFormatterForHandle={() => description} min={min} max={max} step={1} marks={marks} value={value} onChange={onChange} tooltip={{ formatter: () => description }} />
            </div>
        </div>
    );
}
