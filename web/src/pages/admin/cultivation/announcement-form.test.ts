import { describe, expect, test } from "bun:test";

import { normalizeAnnouncementStyle } from "@/lib/announcement-style";
import { announcementFormSnapshot } from "./announcement-form";

describe("announcement unsaved changes", () => {
    const initial = { title: "平台通知", summary: "说明", content: "公告正文", type: "notice" as const, status: "draft" as const, pinned: false, style: normalizeAnnouncementStyle(null) };

    test("opening populated fields and reopening equivalent values stays unchanged", () => {
        expect(announcementFormSnapshot({ ...initial, style: normalizeAnnouncementStyle(initial.style) })).toBe(announcementFormSnapshot(initial));
        expect(announcementFormSnapshot({})).toBe(announcementFormSnapshot({ title: "", summary: "", content: "", type: "notice", status: "draft", pinned: false, style: normalizeAnnouncementStyle(null) }));
    });

    test("normalizes nested style defaults and color casing before comparing", () => {
        expect(announcementFormSnapshot({ ...initial, style: { body: { color: "#382D4D" }, title: { color: "#65446E" } } })).toBe(announcementFormSnapshot(initial));
    });

    test("detects a nested style edit and clears the difference after reverting", () => {
        const values = { ...initial, style: normalizeAnnouncementStyle(initial.style) };
        const opening = announcementFormSnapshot(values);
        values.style.body.lineHeight = 2.2;
        expect(announcementFormSnapshot(values)).not.toBe(opening);
        values.style.body.lineHeight = initial.style.body.lineHeight;
        expect(announcementFormSnapshot(values)).toBe(opening);
    });

    test("detects each content and publication change", () => {
        const opening = announcementFormSnapshot(initial);
        for (const change of [{ title: "新标题" }, { summary: "新摘要" }, { content: "新正文" }, { type: "update" as const }, { status: "published" as const }, { pinned: true }]) {
            expect(announcementFormSnapshot({ ...initial, ...change })).not.toBe(opening);
        }
    });

    test("keeps an invalid in-progress number dirty without blocking close", () => {
        expect(announcementFormSnapshot({ ...initial, style: { ...initial.style, body: { ...initial.style.body, size: null } } })).not.toBe(announcementFormSnapshot(initial));
    });
});
