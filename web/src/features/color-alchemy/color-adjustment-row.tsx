import { useEffect, useRef, useState } from "react";
import { Slider, Tooltip } from "antd";
import { RotateCcw } from "lucide-react";

type ColorAdjustmentRowProps = {
    label: string;
    value: number;
    onChange: (value: number) => void;
    onCommit: () => void;
    min?: number;
    max?: number;
    defaultValue?: number;
    spectrum?: string;
    hint?: string;
};

export function ColorAdjustmentRow({ label, value, onChange, onCommit, min = -100, max = 100, defaultValue = 0, spectrum, hint }: ColorAdjustmentRowProps) {
    const [draft, setDraft] = useState(String(Math.round(value)));
    const [sliderValue, setSliderValue] = useState(value);
    const frameRef = useRef<number | null>(null);
    const pendingValueRef = useRef<number | null>(null);
    const skipBlurRef = useRef(false);

    useEffect(() => {
        setDraft(String(Math.round(value)));
        setSliderValue(value);
    }, [value]);

    useEffect(
        () => () => {
            if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        },
        [],
    );

    const scheduleChange = (next: number) => {
        setSliderValue(next);
        pendingValueRef.current = next;
        if (frameRef.current !== null) return;
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            const pending = pendingValueRef.current;
            pendingValueRef.current = null;
            if (pending !== null) onChange(pending);
        });
    };

    const commitSlider = (next: number) => {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        pendingValueRef.current = null;
        setSliderValue(next);
        onChange(next);
        onCommit();
    };

    const commitDraft = () => {
        if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
        }
        const parsed = Number(draft);
        if (!draft.trim() || !Number.isFinite(parsed)) {
            setDraft(String(Math.round(value)));
            return;
        }
        const next = Math.min(max, Math.max(min, parsed));
        setSliderValue(next);
        onChange(next);
        setDraft(String(Math.round(next)));
        onCommit();
    };

    const reset = () => {
        if (sliderValue === defaultValue) return;
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        pendingValueRef.current = null;
        setSliderValue(defaultValue);
        onChange(defaultValue);
        setDraft(String(Math.round(defaultValue)));
        onCommit();
    };

    return (
        <div className={`color-adjustment-row${spectrum ? " color-adjustment-row--spectrum" : ""}`}>
            <Tooltip title={hint || `${label}：输入数值或拖动滑杆，右侧按钮恢复默认值。`}>
                <span className="color-adjustment-label" tabIndex={0}>
                    {label}
                </span>
            </Tooltip>
            <div className="color-adjustment-slider-wrap">
                {spectrum ? <span className="color-adjustment-spectrum" style={{ background: spectrum }} aria-hidden="true" /> : null}
                <Slider min={min} max={max} value={sliderValue} tooltip={{ open: false }} onChange={scheduleChange} onChangeComplete={commitSlider} aria-label={label} />
            </div>
            <input
                className="color-adjustment-value"
                type="text"
                inputMode="numeric"
                value={draft}
                aria-label={`${label}数值`}
                title="双击恢复默认值"
                onChange={(event) => setDraft(event.target.value.replace(/[^\d-]/g, ""))}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={commitDraft}
                onDoubleClick={reset}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                        event.preventDefault();
                        skipBlurRef.current = true;
                        setDraft(String(Math.round(value)));
                        event.currentTarget.blur();
                    }
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        const direction = event.key === "ArrowUp" ? 1 : -1;
                        const current = Number.isFinite(Number(draft)) ? Number(draft) : value;
                        setDraft(String(Math.min(max, Math.max(min, current + direction))));
                    }
                }}
            />
            <button type="button" className="color-adjustment-reset" aria-label={`重置${label}`} title={`重置${label}`} disabled={sliderValue === defaultValue} onClick={reset}>
                <RotateCcw className="size-3.5" />
            </button>
        </div>
    );
}
