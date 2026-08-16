import { Segmented, Slider } from "antd";
import { Check, Download, LoaderCircle, RotateCcw, Scissors, ShieldCheck, Sparkles } from "lucide-react";

import { DEFAULT_CUTOUT_SETTINGS, type CutoutSettings } from "./cutout-engine";

export type CutoutPreviewBackground = "checkerboard" | "white" | "dark";

export function ColorCutoutPanel({
    hasResult,
    busy,
    progress,
    settings,
    previewBackground,
    onSettingsChange,
    onPreviewBackgroundChange,
    onStart,
    onApply,
    onExport,
    onReset,
}: {
    hasResult: boolean;
    busy: boolean;
    progress: number;
    settings: CutoutSettings;
    previewBackground: CutoutPreviewBackground;
    onSettingsChange: (settings: CutoutSettings) => void;
    onPreviewBackgroundChange: (background: CutoutPreviewBackground) => void;
    onStart: () => void;
    onApply: () => void;
    onExport: () => void;
    onReset: () => void;
}) {
    const patch = (value: Partial<CutoutSettings>) => onSettingsChange({ ...settings, ...value });

    return (
        <aside className="thin-scrollbar h-full overflow-y-auto border-l border-white/8 bg-[#151719]/94 text-[#eeeae0] backdrop-blur-xl">
            <div className="space-y-5 p-4 pb-8">
                <section className="rounded-md border border-[#d7b46a]/24 bg-[#d7b46a]/6 p-3.5">
                    <div className="flex items-center gap-2">
                        <Scissors className="size-4 text-[#e0bd75]" />
                        <h2 className="text-sm font-semibold">智能抠图</h2>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/48">由本站后端识别主体并生成透明底图片。原图只发送到本站服务器，不会转发到第三方抠图服务。</p>
                    <button
                        type="button"
                        disabled={busy}
                        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded bg-[#d7b46a] text-xs font-semibold text-[#18140d] transition hover:bg-[#e5c783] disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={onStart}
                    >
                        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        {busy ? "正在凝聚透明边界" : hasResult ? "重新识别主体" : "开始智能抠图"}
                    </button>
                    {busy ? (
                        <div className="mt-3">
                            <div className="mb-1 flex items-center justify-between text-[10px] text-white/45">
                                <span>正在连接服务器抠图引擎</span>
                                <span className="tabular-nums">{Math.round(progress)}%</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/10">
                                <div className="h-full rounded-full bg-[#d7b46a] transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
                            </div>
                        </div>
                    ) : null}
                </section>

                {hasResult ? (
                    <>
                        <section>
                            <SectionTitle title="边缘增强" icon={<Sparkles className="size-3.5" />} />
                            <div className="space-y-4">
                                <CutoutSlider label="边缘增强" value={settings.edgeEnhancement} onChange={(value) => patch({ edgeEnhancement: value })} />
                                <CutoutSlider label="边缘柔化" value={settings.edgeSoftness} onChange={(value) => patch({ edgeSoftness: value })} />
                                <CutoutSlider label="去除边色" value={settings.decontaminate} onChange={(value) => patch({ decontaminate: value })} />
                            </div>
                            <p className="mt-2 text-[10px] leading-4 text-white/32">增强主体轮廓，柔化锯齿，并减轻白底或彩色背景残边。调整只影响抠图结果，不会改变原图。</p>
                        </section>

                        <section>
                            <SectionTitle title="透明底预览" icon={<ShieldCheck className="size-3.5" />} />
                            <Segmented
                                block
                                size="small"
                                value={previewBackground}
                                options={[
                                    { label: "棋盘格", value: "checkerboard" },
                                    { label: "白底", value: "white" },
                                    { label: "深底", value: "dark" },
                                ]}
                                onChange={(value) => onPreviewBackgroundChange(value as CutoutPreviewBackground)}
                            />
                        </section>

                        <section className="space-y-2 border-t border-white/8 pt-4">
                            <button type="button" className="flex h-9 w-full items-center justify-center gap-2 rounded bg-[#d7b46a] text-xs font-semibold text-[#18140d] transition hover:bg-[#e5c783]" onClick={onApply}>
                                <Check className="size-4" />
                                应用为新灵彩草稿
                            </button>
                            <button type="button" className="flex h-9 w-full items-center justify-center gap-2 rounded border border-white/12 bg-white/5 text-xs text-white/72 transition hover:bg-white/9 hover:text-white" onClick={onExport}>
                                <Download className="size-3.5" />
                                导出透明 PNG
                            </button>
                            <button type="button" className="flex h-8 w-full items-center justify-center gap-2 rounded text-[11px] text-white/42 transition hover:bg-white/6 hover:text-white/78" onClick={() => onSettingsChange(DEFAULT_CUTOUT_SETTINGS)}>
                                <RotateCcw className="size-3.5" />
                                恢复边缘默认值
                            </button>
                            <button type="button" className="h-8 w-full rounded text-[11px] text-white/32 transition hover:text-white/65" onClick={onReset}>
                                清除抠图结果
                            </button>
                        </section>
                    </>
                ) : (
                    <section className="rounded-md border border-dashed border-white/12 bg-white/3 p-3.5 text-xs leading-5 text-white/42">点击“开始智能抠图”识别当前素材。完成后可以在中央预览中拖动分界线检查发丝、边缘与透明底效果。</section>
                )}
            </div>
        </aside>
    );
}

function CutoutSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return (
        <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-white/52">{label}</span>
                <span className="min-w-9 text-right tabular-nums text-white/70">{Math.round(value)}</span>
            </div>
            <Slider min={0} max={100} value={value} tooltip={{ open: false }} onChange={onChange} />
        </div>
    );
}

function SectionTitle({ title, icon }: { title: string; icon?: React.ReactNode }) {
    return (
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-white/78">
            {icon}
            {title}
        </div>
    );
}
