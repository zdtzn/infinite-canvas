import { ColorPicker, Form, InputNumber, Select } from "antd";
import { ANNOUNCEMENT_FONTS, ANNOUNCEMENT_STYLE_LIMITS } from "@/lib/announcement-style";

const fontOptions = Object.entries(ANNOUNCEMENT_FONTS).map(([value, font]) => ({ value, label: <span style={{ fontFamily: font.family }}>{font.label}</span> }));

export function AnnouncementStyleFields() {
    return <div className="announcement-style-fields">
        {(["title", "body"] as const).map((section) => {
            const label = section === "title" ? "标题" : "正文";
            const limits = ANNOUNCEMENT_STYLE_LIMITS[section];
            return <fieldset key={section}>
                <legend>{label}样式</legend>
                <div className="announcement-style-grid">
                    <Form.Item name={["style", section, "font"]} label={`${label}字体`}><Select options={fontOptions} /></Form.Item>
                    <Form.Item name={["style", section, "color"]} label={`${label}颜色`} getValueFromEvent={(color) => color.toHexString()}>
                        <ColorPicker disabledAlpha format="hex" showText presets={[{ label: "宣纸常用色", colors: ["#67421b", "#332418", "#8f3025", "#365e50", "#304e70", "#64416e"] }]} />
                    </Form.Item>
                    <Form.Item name={["style", section, "size"]} label={`${label}字号（px）`} rules={[{ required: true, message: "请填写字号" }, { type: "number", min: limits.size[0], max: limits.size[1] }]}>
                        <InputNumber min={limits.size[0]} max={limits.size[1]} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name={["style", section, "weight"]} label={`${label}粗细`}>
                        <Select options={[{ value: 400, label: "常规" }, { value: 600, label: "稍粗" }, { value: 700, label: "加粗" }]} />
                    </Form.Item>
                    <Form.Item name={["style", section, "letterSpacing"]} label={`${label}字间距（字宽）`} rules={[{ required: true, message: "请填写字间距" }, { type: "number", min: limits.letterSpacing[0], max: limits.letterSpacing[1] }]}>
                        <InputNumber min={limits.letterSpacing[0]} max={limits.letterSpacing[1]} step={0.01} precision={2} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name={["style", section, "lineHeight"]} label={`${label}行距（倍）`} rules={[{ required: true, message: "请填写行距" }, { type: "number", min: limits.lineHeight[0], max: limits.lineHeight[1] }]}>
                        <InputNumber min={limits.lineHeight[0]} max={limits.lineHeight[1]} step={0.1} precision={1} style={{ width: "100%" }} />
                    </Form.Item>
                </div>
            </fieldset>;
        })}
    </div>;
}
