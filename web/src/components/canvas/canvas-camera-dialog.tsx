import { useEffect, useId, useState } from "react";
import { Button, Modal, Select, Switch } from "antd";
import { RotateCcw } from "lucide-react";
import { APERTURES, CAMERA_PROFILES, DEFAULT_CAMERA_SETTINGS, FOCAL_LENGTHS, LENS_PROFILES, normalizeCameraSettings } from "@/lib/canvas/canvas-camera";
import type { CanvasCameraSettings } from "@/types/canvas";

export type CanvasCameraDialogProps = {
    open: boolean;
    settings?: CanvasCameraSettings;
    onSave: (settings: CanvasCameraSettings) => void;
    onClose: () => void;
};

export function CanvasCameraDialog({ open, settings, onSave, onClose }: CanvasCameraDialogProps) {
    const [draft, setDraft] = useState(() => normalizeCameraSettings(settings));
    const id = useId();

    useEffect(() => {
        if (open) setDraft(normalizeCameraSettings(settings));
    }, [open, settings]);

    const update = <Key extends keyof CanvasCameraSettings>(key: Key, value: CanvasCameraSettings[Key]) => setDraft((current) => ({ ...current, [key]: value }));

    return (
        <Modal title="摄影参数" open={open} onCancel={onClose} footer={null} width={560} centered destroyOnHidden>
            <div className="space-y-5 pt-2">
                <p className="text-sm opacity-60">仅作为图片和视频生成的提示引导，实际效果取决于模型。保存后在下次生成时生效。</p>
                <div className="flex items-center justify-between gap-3">
                    <label htmlFor={`${id}-enabled`} className="font-medium">
                        启用摄影参数
                    </label>
                    <Switch id={`${id}-enabled`} checked={draft.enabled} onChange={(value) => update("enabled", value)} checkedChildren="开启" unCheckedChildren="关闭" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                        <label htmlFor={`${id}-camera`} className="block text-sm">
                            机身风格
                        </label>
                        <Select
                            id={`${id}-camera`}
                            className="w-full"
                            disabled={!draft.enabled}
                            allowClear
                            placeholder="不指定机身"
                            value={draft.cameraId}
                            options={CAMERA_PROFILES.map(({ id, label }) => ({ value: id, label }))}
                            onChange={(value) => update("cameraId", value)}
                        />
                    </div>
                    <div className="min-w-0 space-y-2">
                        <label htmlFor={`${id}-lens`} className="block text-sm">
                            镜头风格
                        </label>
                        <Select
                            id={`${id}-lens`}
                            className="w-full"
                            disabled={!draft.enabled}
                            allowClear
                            placeholder="不指定镜头"
                            value={draft.lensId}
                            options={LENS_PROFILES.map(({ id, label }) => ({ value: id, label }))}
                            onChange={(value) => update("lensId", value)}
                        />
                    </div>
                    <div className="min-w-0 space-y-2">
                        <label htmlFor={`${id}-focal`} className="block text-sm">
                            焦距
                        </label>
                        <Select
                            id={`${id}-focal`}
                            className="w-full"
                            disabled={!draft.enabled}
                            allowClear
                            placeholder="不指定焦距"
                            value={draft.focalLength}
                            options={FOCAL_LENGTHS.map((value) => ({ value, label: `${value} mm` }))}
                            onChange={(value) => update("focalLength", value)}
                        />
                    </div>
                    <div className="min-w-0 space-y-2">
                        <label htmlFor={`${id}-aperture`} className="block text-sm">
                            光圈
                        </label>
                        <Select
                            id={`${id}-aperture`}
                            className="w-full"
                            disabled={!draft.enabled}
                            allowClear
                            placeholder="不指定光圈"
                            value={draft.aperture}
                            options={APERTURES.map((value) => ({ value, label: `f/${value}` }))}
                            onChange={(value) => update("aperture", value)}
                        />
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button type="text" icon={<RotateCcw className="size-4" />} onClick={() => setDraft({ ...DEFAULT_CAMERA_SETTINGS })}>
                        重置参数
                    </Button>
                    <div className="flex gap-2">
                        <Button type="text" onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" onClick={() => onSave(normalizeCameraSettings(draft))}>
                            保存参数
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
