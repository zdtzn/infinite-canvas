export const ANNOUNCEMENT_FONTS = {
  kai: { label: "楷体 · 古雅", family: '"STKaiti", "KaiTi", "Kaiti SC", "Noto Serif SC", serif' },
  song: { label: "宋体 · 书卷", family: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif' },
  sans: { label: "黑体 · 清晰", family: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif' },
} as const;

export type AnnouncementTextStyle = {
  font: keyof typeof ANNOUNCEMENT_FONTS;
  color: string;
  size: number;
  weight: 400 | 600 | 700;
  letterSpacing: number;
  lineHeight: number;
};
export type AnnouncementStyle = { title: AnnouncementTextStyle; body: AnnouncementTextStyle };

export const DEFAULT_ANNOUNCEMENT_STYLE: AnnouncementStyle = {
  title: { font: "kai", color: "#65446e", size: 30, weight: 700, letterSpacing: 0.1, lineHeight: 1.5 },
  body: { font: "song", color: "#382d4d", size: 18, weight: 600, letterSpacing: 0.06, lineHeight: 2 },
};
export const ANNOUNCEMENT_STYLE_LIMITS = {
  title: { size: [20, 48], letterSpacing: [0, 0.3], lineHeight: [1.2, 2.4] },
  body: { size: [16, 28], letterSpacing: [0, 0.2], lineHeight: [1.4, 2.8] },
} as const;

// Omitted style preserves the current value; null resets it. A supplied object
// replaces the style, with missing properties filled from the defaults.
export function normalizeAnnouncementStyle(value: unknown): AnnouncementStyle {
  const result = { title: { ...DEFAULT_ANNOUNCEMENT_STYLE.title }, body: { ...DEFAULT_ANNOUNCEMENT_STYLE.body } };
  if (value == null) return result;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("公告文字样式无效");
  for (const section of ["title", "body"] as const) {
    const input = (value as Record<string, unknown>)[section];
    if (input === undefined) continue;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("公告文字样式无效");
    const fields = input as Record<string, unknown>;
    const label = section === "title" ? "标题" : "正文";
    if (fields.font !== undefined) {
      if (typeof fields.font !== "string" || !Object.hasOwn(ANNOUNCEMENT_FONTS, fields.font)) throw new Error(`${label}字体无效`);
      result[section].font = fields.font as AnnouncementTextStyle["font"];
    }
    if (fields.color !== undefined) {
      if (typeof fields.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(fields.color)) throw new Error(`${label}颜色须为六位色值`);
      result[section].color = fields.color.toLowerCase();
    }
    if (fields.weight !== undefined) {
      if (fields.weight !== 400 && fields.weight !== 600 && fields.weight !== 700) throw new Error(`${label}字重无效`);
      result[section].weight = fields.weight;
    }
    for (const key of ["size", "letterSpacing", "lineHeight"] as const) {
      const number = fields[key];
      if (number === undefined) continue;
      const [min, max] = ANNOUNCEMENT_STYLE_LIMITS[section][key];
      if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) throw new Error(`${label}字号或间距超出可用范围`);
      result[section][key] = Math.round(number * 100) / 100;
    }
  }
  return result;
}
