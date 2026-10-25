import { normalizeAnnouncementStyle } from "@/lib/announcement-style";
import type { AnnouncementInput } from "@/services/server-api";

export function announcementFormSnapshot(values: Omit<Partial<AnnouncementInput>, "style"> & { style?: unknown }) {
    let style = values.style;
    try { style = normalizeAnnouncementStyle(style); }
    catch { /* Invalid in-progress values still count as unsaved changes. */ }
    return JSON.stringify({
        title: values.title || "",
        summary: values.summary || "",
        content: values.content || "",
        type: values.type || "notice",
        status: values.status || "draft",
        pinned: Boolean(values.pinned),
        style,
    });
}
