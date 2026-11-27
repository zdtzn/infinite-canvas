export function serializeReferenceEditor(editor: HTMLElement) {
    return serializeNodes(editor.childNodes).replace(/\uFEFF/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let text = "";
    for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent || "";
        if (!(node instanceof HTMLElement)) continue;
        if (node.dataset.referenceValue) text += node.dataset.referenceValue;
        else if (node.tagName === "BR") text += "\n";
        else text += serializeNodes(node.childNodes);
    }
    return text;
}

function selectionRange(editor: HTMLElement, selection: Selection | null) {
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    return range && editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
}

export function readReferenceMention(editor: HTMLElement) {
    const range = selectionRange(editor, window.getSelection())?.cloneRange();
    if (!range) return null;
    range.setStart(editor, 0);
    return /@([^\s@]*)$/.exec(range.toString())?.[1] ?? null;
}

export function insertEditorReference(editor: HTMLElement, chip: HTMLElement) {
    const selection = window.getSelection();
    const range = selectionRange(editor, selection);
    const space = document.createTextNode(" ");
    if (!range) {
        editor.append(chip, space);
        selection?.collapse(editor, editor.childNodes.length);
        return;
    }

    const mention = readReferenceMention(editor);
    if (mention !== null) {
        range.setStart(range.startContainer, Math.max(0, range.startOffset - mention.length - 1));
        range.deleteContents();
    }
    range.insertNode(space);
    range.insertNode(chip);
    range.setStartAfter(space);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
}

// A reference chip is atomic when Backspace or Delete reaches it.
export function deleteAdjacentEditorReference(editor: HTMLElement, key: "Backspace" | "Delete") {
    const selection = window.getSelection();
    if (!selection?.isCollapsed) return false;
    const range = selectionRange(editor, selection);
    if (!range) return false;
    const target = adjacentReference(range, key === "Backspace");
    if (!target) return false;
    const caret = document.createTextNode("");
    target.replaceWith(caret);
    selection.collapse(caret, 0);
    return true;
}

function adjacentReference(range: Range, previous: boolean) {
    const { startContainer: container, startOffset: offset } = range;
    const sibling = (node: Node) => previous ? node.previousSibling : node.nextSibling;
    let candidate: Node | null;
    if (container.nodeType === Node.TEXT_NODE) {
        if (previous ? offset > 0 : offset < (container.textContent || "").length) return null;
        candidate = sibling(container);
    } else {
        candidate = container.childNodes[previous ? offset - 1 : offset] || container;
    }
    while (candidate?.nodeType === Node.TEXT_NODE && !candidate.textContent?.trim()) candidate = sibling(candidate);
    return candidate instanceof HTMLElement && candidate.dataset.referenceValue ? candidate : null;
}
