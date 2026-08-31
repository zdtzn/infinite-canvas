import { useEffect, useState } from "react";
import { Slider } from "antd";

type ColorAdjustmentRowProps = {
    label: string;
    value: number;
    onChange: (value: number) => void;
    onCommit: () => void;
    min?: number;
    max?: number;
    defaultValue?: number;
    spectrum?: string;
};

export function ColorAdjustmentRow({ label, value, onChange, onCommit, min = -100, max = 100, defaultValue = 0, spectrum }: ColorAdjustmentRowProps) {
    const [draft, setDraft] = useState(String(Math.round(value)));

    useEffect(() => setDraft(String(Math.round(value))), [value]);

    const commitDraft = () => {
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) {
            setDraft(String(Math.round(value)));
            return;
        }
        const next = Math.min(max, Math.max(min, parsed));
        onChange(next);
        setDraft(String(Math.round(next)));
        onCommit();
    };

    const reset = () => {
        if (value === defaultValue) return;
        onChange(defaultValue);
        setDraft(String(Math.round(defaultValue)));
        onCommit();
    };

    return (
        <div className={`color-adjustment-row${spectrum ? " color-adjustment-row--spectrum" : ""}`}>
            <button type="button" className="color-adjustment-label" title="双击恢复默认值" onDoubleClick={reset}>
                {label}
            </button>
            <div className="color-adjustment-slider-wrap">
                {spectrum ? <span className="color-adjustment-spectrum" style={{ background: spectrum }} aria-hidden="true" /> : null}
                <Slider min={min} max={max} value={value} tooltip={{ open: false }} onChange={onChange} onChangeComplete={onCommit} aria-label={label} />
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
        </div>
    );
}
