import { expect, test } from "bun:test";
import { canvasGroupShortcut, shouldStopCanvasPan } from "./canvas-shortcuts";
test("group shortcut handles Windows and Mac and ignores composition, repeats and alt", () => {
    const base = { key: "g", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false };
    expect(canvasGroupShortcut(base)).toBe("group");
    expect(canvasGroupShortcut({ ...base, ctrlKey: false, metaKey: true, shiftKey: true })).toBe("ungroup");
    for (const patch of [{ altKey: true }, { repeat: true }, { isComposing: true }, { ctrlKey: false }, { key: "a" }]) expect(canvasGroupShortcut({ ...base, ...patch })).toBeNull();
});
test("missing mouse release ends pan without treating touch as released", () => {
    expect(shouldStopCanvasPan({ pointerType: "mouse", buttons: 0 })).toBe(true);
    expect(shouldStopCanvasPan({ pointerType: "mouse", buttons: 1 })).toBe(false);
    expect(shouldStopCanvasPan({ pointerType: "mouse", buttons: 4 })).toBe(false);
    expect(shouldStopCanvasPan({ pointerType: "touch", buttons: 0 })).toBe(false);
});
