export function canvasGroupShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "repeat">) {
    if (event.isComposing || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "g") return null;
    return event.shiftKey ? "ungroup" : "group";
}

export function shouldStopCanvasPan(event: Pick<PointerEvent, "pointerType" | "buttons">) {
    return event.pointerType !== "touch" && event.buttons === 0;
}
