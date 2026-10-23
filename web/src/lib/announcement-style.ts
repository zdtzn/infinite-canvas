import type { CSSProperties } from "react";
import { ANNOUNCEMENT_FONTS, normalizeAnnouncementStyle, type AnnouncementStyle } from "../../../shared/announcement-style";

export { ANNOUNCEMENT_FONTS, ANNOUNCEMENT_STYLE_LIMITS, DEFAULT_ANNOUNCEMENT_STYLE, normalizeAnnouncementStyle } from "../../../shared/announcement-style";
export type { AnnouncementStyle } from "../../../shared/announcement-style";

export function announcementStyleVariables(style?: AnnouncementStyle | null): CSSProperties {
    const values = normalizeAnnouncementStyle(style);
    return Object.fromEntries(Object.entries(values).flatMap(([section, value]) => [
        [`--announcement-${section}-font`, ANNOUNCEMENT_FONTS[value.font].family],
        [`--announcement-${section}-color`, value.color],
        [`--announcement-${section}-size`, `${value.size}px`],
        [`--announcement-${section}-weight`, value.weight],
        [`--announcement-${section}-spacing`, `${value.letterSpacing}em`],
        [`--announcement-${section}-height`, value.lineHeight],
    ])) as CSSProperties;
}
