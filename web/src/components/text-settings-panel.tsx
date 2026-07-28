import { Segmented } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

const reasoningEffortOptions: Array<{ value: ReasoningEffort; label: string }> = [
    { value: "auto", label: "自动" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
    { value: "xhigh", label: "极高" },
];

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    className?: string;
};

export function TextSettingsPanel({ config, onConfigChange, theme, className = "space-y-4" }: TextSettingsPanelProps) {
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <div className="text-lg font-semibold">文本设置</div>
                <div className="space-y-2.5">
                    <div className="text-sm font-medium" style={{ color: theme.node.muted }}>
                        推理强度
                    </div>
                    <Segmented
                        block
                        size="small"
                        value={config.reasoningEffort}
                        options={reasoningEffortOptions}
                        onChange={(value) => onConfigChange("reasoningEffort", value as ReasoningEffort)}
                    />
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        自动模式由模型决定；更高强度可能增加响应时间和上游消耗。
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
    return reasoningEffortOptions.find((item) => item.value === value)?.label || "自动";
}
